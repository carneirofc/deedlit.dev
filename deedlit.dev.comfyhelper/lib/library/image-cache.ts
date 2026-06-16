import { getRedisClient } from "@/lib/library/db/redis";
import { blobUrl } from "@/lib/api-client";

const TTL = 7 * 24 * 60 * 60; // 7 days

type ImageKind = "thumb" | "orig";

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
    return { data, contentType: ct ?? (kind === "thumb" ? "image/webp" : "image/jpeg") };
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

/**
 * Fire-and-forget: fetch the original image and store it in cache.
 * Called when serving a thumbnail so the original is hot when the user opens the full view.
 */
export function warmOriginal(sha256: string): void {
  const upstream = blobUrl(sha256, "original");
  if (!upstream) return;
  getCachedImage(sha256, "orig")
    .then((cached) => {
      if (cached) return;
      return fetch(upstream, { cache: "no-store" }).then(async (res) => {
        if (!res.ok) return;
        const ct = res.headers.get("content-type") ?? "image/jpeg";
        const buf = Buffer.from(await res.arrayBuffer());
        return setCachedImage(sha256, "orig", buf, ct);
      });
    })
    .catch(() => {/* fire-and-forget — silent on error */});
}
