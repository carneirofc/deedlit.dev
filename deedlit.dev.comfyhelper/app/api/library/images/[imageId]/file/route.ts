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

function contentTypeFor(extension: string | null): string {
  switch ((extension ?? "").toLowerCase()) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

/**
 * Stream the full-resolution original image. Companion to the `/thumbnail`
 * route: this always serves the original (never the WebP thumbnail) so the
 * `image_url` stored in the Qdrant payload resolves to the real asset.
 * Resolves either an `s3://…` object-store pointer (RustFS) or a local
 * filesystem path.
 */
export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    await ensureLibrarySchema();
    const detail = await getImageDetail(imageId);
    if (!detail) return jsonError("Image not found.", 404);

    const headers = { "cache-control": "public, max-age=86400", "content-type": contentTypeFor(detail.extension) };

    // 1. Object-store original.
    if (parseObjectUri(detail.filePath)) {
      const stream = await getObjectWebStream(detail.filePath);
      if (!stream) return jsonError("Image object missing.", 404);
      return new Response(stream as unknown as BodyInit, { headers });
    }

    // 2. Local filesystem.
    try {
      await stat(detail.filePath);
    } catch {
      return jsonError("Image file missing.", 404);
    }
    const webStream = Readable.toWeb(createReadStream(detail.filePath)) as unknown as ReadableStream;
    return new Response(webStream as unknown as BodyInit, { headers });
  });
}
