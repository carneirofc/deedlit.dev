import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { handleRoute, jsonError } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { getImageDetail } from "@/lib/library/repositories/image-repository";
import { getObjectWebStream, parseObjectUri } from "@/lib/library/storage/object-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

/**
 * Stream the WebP thumbnail. Resolves either an `s3://…` object-store pointer
 * (RustFS) or a local filesystem path. Falls back to the original image file
 * when no thumbnail exists.
 */
export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    await ensureLibrarySchema();
    const detail = await getImageDetail(imageId);
    if (!detail) return jsonError("Image not found.", 404);

    const headers = { "cache-control": "public, max-age=86400" };

    // 1. Object-store thumbnail.
    if (detail.thumbnailPath && parseObjectUri(detail.thumbnailPath)) {
      const stream = await getObjectWebStream(detail.thumbnailPath);
      if (!stream) return jsonError("Thumbnail object missing.", 404);
      return new Response(stream as unknown as BodyInit, {
        headers: { ...headers, "content-type": "image/webp" },
      });
    }

    // 2. Local filesystem (thumbnail or original fallback).
    const filePath = detail.thumbnailPath ?? detail.filePath;
    const isThumb = Boolean(detail.thumbnailPath);
    try {
      await stat(filePath);
    } catch {
      return jsonError("Thumbnail file missing.", 404);
    }
    const webStream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;
    const contentType = isThumb
      ? "image/webp"
      : detail.extension === ".png"
        ? "image/png"
        : "image/jpeg";
    return new Response(webStream as unknown as BodyInit, {
      headers: { ...headers, "content-type": contentType },
    });
  });
}
