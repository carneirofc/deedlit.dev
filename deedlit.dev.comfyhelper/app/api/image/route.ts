import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";
import sharp from "sharp";
import { ZodError } from "zod";

import { DeleteImageBodySchema, DeleteImageResponseSchema, ImageQuerySchema } from "@/lib/contracts/api";
import { errorJson, jsonWithSchema, zodErrorMessage } from "@/lib/http/route-response";
import { getTrashcanDirectory } from "@/lib/config-store";
import { loadVisibleRootsContext } from "@/lib/http/route-context";
import { getCachedImageById, removeCachedImageEntry } from "@/lib/image-cache-store";
import { moveToTrash } from "@/lib/image-trash";
import { isAllowedImagePath } from "@/lib/library-scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extensionToMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".avif": return "image/avif";
    case ".png":
    default: return "image/png";
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { path: requestedPath, format } = ImageQuerySchema.parse({
      path: searchParams.get("path") ?? undefined,
      format: searchParams.get("format") ?? undefined,
    });

    const { roots } = await loadVisibleRootsContext();
    if (!isAllowedImagePath(requestedPath, roots)) {
      return errorJson("Image path is not allowed.", 403);
    }

    let imageStats;
    try {
      imageStats = await stat(requestedPath);
    } catch {
      return errorJson("Image file not found.", 404);
    }

    if (!imageStats.isFile()) {
      return errorJson("Image path does not point to a file.", 404);
    }

    // ETag based on file size + mtime + format for efficient caching
    const etag = `"${imageStats.size.toString(36)}-${imageStats.mtimeMs.toString(36)}${format ? `-${format}` : ""}"`;
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag },
      });
    }

    const contentType = extensionToMimeType(extname(requestedPath));
    const stream = createReadStream(requestedPath);
    request.signal.addEventListener("abort", () => {
      stream.destroy();
    }, { once: true });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(imageStats.size),
        "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
        ETag: etag,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid image path."), 400);
    }

    return errorJson("Failed to load image.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = await request.json();
    const { id: imageId, path: requestedPath } = DeleteImageBodySchema.parse(payload);
    const trashDirectory = await getTrashcanDirectory();
    if (!trashDirectory) {
      return errorJson("Trashcan directory is not configured.", 409);
    }

    const { roots, rootIdSet } = await loadVisibleRootsContext();
    const cachedImage = await getCachedImageById(imageId);
    if (!cachedImage) {
      return errorJson("Image cache entry not found.", 404);
    }
    if (!rootIdSet.has(cachedImage.rootId)) {
      return errorJson("Image is not in a visible root.", 403);
    }
    if (cachedImage.absolutePath !== requestedPath) {
      return errorJson("Selected image path does not match cached entry.", 409);
    }

    if (!isAllowedImagePath(requestedPath, roots)) {
      return errorJson("Image path is not allowed.", 403);
    }

    let imageStats;
    try {
      imageStats = await stat(requestedPath);
    } catch {
      return errorJson("Image file not found.", 404);
    }

    if (!imageStats.isFile()) {
      return errorJson("Image path does not point to a file.", 404);
    }

    await moveToTrash(requestedPath, trashDirectory);
    await removeCachedImageEntry(imageId);
    return jsonWithSchema(DeleteImageResponseSchema, { deleted: true });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid image path."), 400);
    }

    return errorJson("Failed to move image to trash.", 500);
  }
}
