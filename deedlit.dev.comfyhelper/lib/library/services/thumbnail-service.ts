import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { getLibraryConfig } from "@/lib/library/config";
import { isObjectStoreEnabled, putObject } from "@/lib/library/storage/object-store";

/** Stable object-store key / local subpath for a thumbnail. */
export function thumbnailKey(sha256: string, size: "small" | "medium" = "medium"): string {
  const shard = sha256.slice(0, 2);
  return `thumbnails/${size}/${shard}/${sha256}.webp`;
}

/** Deterministic local thumbnail path (filesystem fallback mode). */
export function thumbnailPathFor(sha256: string, size: "small" | "medium" = "medium"): string {
  const { thumbnailRoot } = getLibraryConfig();
  return path.join(thumbnailRoot, thumbnailKey(sha256, size));
}

/**
 * Generate a WebP thumbnail and persist it.
 *
 * When object storage (RustFS/S3) is enabled the thumbnail is uploaded and an
 * `s3://bucket/key` URI is returned; otherwise it is written to the local
 * filesystem and the absolute path is returned.  The returned string is what
 * gets stored in `images.thumbnail_path`, and the thumbnail route resolves
 * either form transparently.
 */
export async function generateThumbnail(
  sourcePath: string,
  sha256: string,
  size: "small" | "medium" = "medium",
): Promise<string> {
  const { thumbnailSizes } = getLibraryConfig();
  const dimension = thumbnailSizes[size];
  // `fit: "outside"` scales so the SHORTER edge hits `dimension` (the longer
  // edge stays proportionally larger); `withoutEnlargement` keeps a smaller
  // source at native size. Lossless WebP so the thumbnail is viewer-grade.
  const buffer = await sharp(sourcePath)
    .resize(dimension, dimension, { fit: "outside", withoutEnlargement: true })
    .webp({ lossless: true })
    .toBuffer();

  if (isObjectStoreEnabled()) {
    return putObject(thumbnailKey(sha256, size), buffer, "image/webp");
  }

  const target = thumbnailPathFor(sha256, size);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer);
  return target;
}

/** Stable opaque id used in thumbnail URLs (kept distinct from the DB id). */
export function thumbnailToken(sha256: string): string {
  return createHash("sha1").update(sha256).digest("hex").slice(0, 16);
}
