import { handleRoute, jsonError } from "@/lib/library/http";
import { blobUrl } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

/**
 * Stream an image thumbnail.
 *
 * comfyhelper is UI-only and holds no object store, so bytes are proxied from
 * an upstream blob service (DEEDLIT_BLOB_URL -> /blobs/{sha}/thumbnail).
 *
 * DEGRADED: the deedlit.api gateway does not (yet) proxy catalog blobs, so when
 * DEEDLIT_BLOB_URL is unset this returns 404 and the UI shows a broken image.
 * TODO(#17): set DEEDLIT_BLOB_URL to the gateway once it proxies blobs.
 */
export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    const upstream = blobUrl(imageId, "thumbnail");
    if (!upstream) return jsonError("Thumbnail serving is not configured (set DEEDLIT_BLOB_URL).", 404);

    const res = await fetch(upstream, { cache: "no-store" });
    if (!res.ok || !res.body) return jsonError("Thumbnail not found.", res.status === 404 ? 404 : 502);
    return new Response(res.body as unknown as BodyInit, {
      headers: {
        "cache-control": "public, max-age=86400",
        "content-type": res.headers.get("content-type") ?? "image/webp",
      },
    });
  });
}
