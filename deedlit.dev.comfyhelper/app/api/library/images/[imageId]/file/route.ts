import { handleRoute, jsonError } from "@/lib/library/http";
import { blobUrl } from "@/lib/api-client";
import { getCachedImage, setCachedImage, IMAGE_CACHE_CONTROL } from "@/lib/library/image-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

/**
 * Stream the full-resolution image.
 *
 * DEGRADED: the deedlit.api gateway does not (yet) proxy catalog blobs, and the
 * catalog only exposes thumbnail/embedding blobs (no original-bytes route), so
 * this falls back to the thumbnail blob when an upstream is configured and 404s
 * otherwise.
 * TODO(#17): serve originals once the gateway/catalog expose original bytes.
 */
export async function GET(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;

    // Content-addressed by sha256 -> immutable. A matching If-None-Match returns
    // a 0-byte 304 without touching Redis or the gateway.
    const etag = `"${imageId}-orig"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { "cache-control": IMAGE_CACHE_CONTROL, etag },
      });
    }

    const cached = await getCachedImage(imageId, "orig");
    if (cached) {
      return new Response(cached.data as unknown as BodyInit, {
        headers: {
          "cache-control": IMAGE_CACHE_CONTROL,
          etag,
          "content-type": cached.contentType,
        },
      });
    }

    const upstream = blobUrl(imageId, "original");
    if (!upstream) return jsonError("Image serving is not configured (set DEEDLIT_BLOB_URL).", 404);

    const res = await fetch(upstream, { cache: "no-store" });
    if (!res.ok || !res.body) return jsonError("Image not found.", res.status === 404 ? 404 : 502);

    const ct = res.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());

    setCachedImage(imageId, "orig", buf, ct).catch(() => {});

    return new Response(buf as unknown as BodyInit, {
      headers: {
        "cache-control": IMAGE_CACHE_CONTROL,
        etag,
        "content-type": ct,
      },
    });
  });
}
