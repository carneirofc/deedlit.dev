import sharp from "sharp";

import { handleRoute, jsonError } from "@/lib/library/http";
import { blobUrl } from "@/lib/api-client";
import { getCachedImage, setCachedImage, IMAGE_CACHE_CONTROL } from "@/lib/library/image-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

// Grid card tile: a small WebP derived on demand from the larger preview blob.
// The grid was downloading the full ~1080-1600px viewer image into 64-300px
// cells (a 40-card page = ~40 near-full-res images). This downscales the
// EXISTING RustFS thumbnail (never the slow-FS original) once per image, caches
// the result in Redis, and serves it with immutable HTTP caching so the browser
// then keeps it. 512px covers small-to-spacious cells at 2x DPR.
const GRID_MAX_EDGE = 512;
const GRID_QUALITY = 90;

/**
 * Serve the small grid-tile derivative of an image (lazy, on first request).
 *
 * Strategy: 304 on a matching validator -> Redis hit -> else fetch the upstream
 * thumbnail blob, downscale to a <=512px WebP via sharp, cache it, and return it.
 * Bytes come from RustFS (the thumbnail blob), so this never touches the slow
 * read-only filesystem.
 */
export async function GET(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;

    // Content-addressed by sha256 -> immutable. A matching If-None-Match returns
    // a 0-byte 304 without touching Redis, the gateway, or sharp.
    const etag = `"${imageId}-grid"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { "cache-control": IMAGE_CACHE_CONTROL, etag },
      });
    }

    const cached = await getCachedImage(imageId, "grid");
    if (cached) {
      return new Response(cached.data as unknown as BodyInit, {
        headers: {
          "cache-control": IMAGE_CACHE_CONTROL,
          etag,
          "content-type": cached.contentType,
        },
      });
    }

    const upstream = blobUrl(imageId, "thumbnail");
    if (!upstream) return jsonError("Image serving is not configured (set DEEDLIT_BLOB_URL).", 404);

    const res = await fetch(upstream, { cache: "no-store" });
    if (!res.ok || !res.body) return jsonError("Image not found.", res.status === 404 ? 404 : 502);

    const src = Buffer.from(await res.arrayBuffer());

    // If the source is already at or below grid size, downscaling is a no-op and
    // re-encoding would only soften an already-small image. Serve the original
    // bytes untouched (the upstream thumbnail is already viewer-grade WebP).
    const pipeline = sharp(src).rotate(); // honor EXIF orientation
    const meta = await pipeline.metadata();
    const maxEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (maxEdge > 0 && maxEdge <= GRID_MAX_EDGE) {
      const ct = res.headers.get("content-type") ?? "image/webp";
      setCachedImage(imageId, "grid", src, ct).catch(() => {});
      return new Response(src as unknown as BodyInit, {
        headers: {
          "cache-control": IMAGE_CACHE_CONTROL,
          etag,
          "content-type": ct,
        },
      });
    }

    const out = await pipeline
      .resize(GRID_MAX_EDGE, GRID_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: GRID_QUALITY })
      .toBuffer();

    setCachedImage(imageId, "grid", out, "image/webp").catch(() => {});

    return new Response(out as unknown as BodyInit, {
      headers: {
        "cache-control": IMAGE_CACHE_CONTROL,
        etag,
        "content-type": "image/webp",
      },
    });
  });
}
