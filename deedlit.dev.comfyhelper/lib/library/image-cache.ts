import { getRedisClient } from "@/lib/library/db/redis";

const TTL = 7 * 24 * 60 * 60; // 7 days

/**
 * Cache-Control for image-byte responses. Blobs are content-addressed by sha256,
 * so a given image URL is immutable: cache for a year and mark immutable so the
 * browser/CDN never revalidates a fresh asset. Paired with a per-route ETag this
 * makes repeat views free (browser cache) and revalidations a 0-byte 304. This,
 * not Redis, is the primary cache — Redis is only a hot shield in front of RustFS.
 */
export const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

// "grid" = the small (~512px) WebP card tile, derived on demand from the larger
// "thumbnail" blob (see the /grid route). "thumb" = the ~1080-1600px preview the
// lightbox uses; "orig" reserved for a true original (not served today).
type ImageKind = "thumb" | "orig" | "grid";

export interface CachedImage {
  data: Buffer;
  contentType: string;
}

function dataKey(sha256: string, kind: ImageKind): string {
  return `img:${sha256}:${kind}:data`;
}

function ctKey(sha256: string, kind: ImageKind): string {
  return `img:${sha256}:${kind}:ct`;
}

export async function getCachedImage(sha256: string, kind: ImageKind): Promise<CachedImage | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const results = await redis
      .pipeline()
      .getBuffer(dataKey(sha256, kind))
      .get(ctKey(sha256, kind))
      .exec();
    if (!results) return null;
    const data = results[0][1] as Buffer | null;
    const ct = results[1][1] as string | null;
    if (!data) return null;
    return { data, contentType: ct ?? (kind === "orig" ? "image/jpeg" : "image/webp") };
  } catch {
    return null;
  }
}

export async function setCachedImage(sha256: string, kind: ImageKind, data: Buffer, contentType: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis
      .pipeline()
      .setex(dataKey(sha256, kind), TTL, data)
      .setex(ctKey(sha256, kind), TTL, contentType)
      .exec();
  } catch {
    // best-effort
  }
}
