import { handleRoute, jsonError } from "@/lib/library/http";
import { blobUrl } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

/**
 * Stream the full-resolution image.
 *
 * comfyhelper is UI-only and holds no object store, so bytes are proxied from
 * an upstream blob service (DEEDLIT_BLOB_URL -> /blobs/{sha}/...).
 *
 * DEGRADED: the deedlit.api gateway does not (yet) proxy catalog blobs, and the
 * catalog only exposes thumbnail/embedding blobs (no original-bytes route), so
 * this falls back to the thumbnail blob when an upstream is configured and 404s
 * otherwise.
 * TODO(#17): serve originals once the gateway/catalog expose original bytes.
 */
export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    const upstream = blobUrl(imageId, "original");
    if (!upstream) return jsonError("Image serving is not configured (set DEEDLIT_BLOB_URL).", 404);

    const res = await fetch(upstream, { cache: "no-store" });
    if (!res.ok || !res.body) return jsonError("Image not found.", res.status === 404 ? 404 : 502);
    return new Response(res.body as unknown as BodyInit, {
      headers: {
        "cache-control": "public, max-age=86400",
        "content-type": res.headers.get("content-type") ?? "image/jpeg",
      },
    });
  });
}
