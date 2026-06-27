import { getRedisClient } from "@/lib/library/db/redis";
import { handleRoute, jsonError } from "@/lib/library/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface CacheStatsResponse {
  configured: boolean;
  connected: boolean;
  redisUrl: string | null;
  stats: {
    thumbCount: number;
    origCount: number;
    totalDataKeys: number;
    usedMemoryHuman: string | null;
    usedMemoryBytes: number | null;
    maxMemoryHuman: string | null;
    keyspaceHits: number | null;
    keyspaceMisses: number | null;
    hitRate: number | null;
  };
  sample: Array<{
    sha256: string;
    hasThumb: boolean;
    hasOrig: boolean;
    thumbTtl: number | null;
    origTtl: number | null;
  }>;
}

async function scanKeys(redis: ReturnType<typeof getRedisClient>, pattern: string): Promise<string[]> {
  if (!redis) return [];
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    keys.push(...batch);
    cursor = nextCursor;
  } while (cursor !== "0");
  return keys;
}

function parseMemoryInfo(info: string, field: string): string | null {
  const match = info.match(new RegExp(`^${field}:(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

function parseStatsInfo(info: string, field: string): number | null {
  const match = info.match(new RegExp(`^${field}:(\\d+)$`, "m"));
  return match ? parseInt(match[1], 10) : null;
}

export async function GET() {
  return handleRoute(async () => {
    const redisUrl = process.env.REDIS_URL?.trim() ?? null;

    if (!redisUrl) {
      const body: CacheStatsResponse = {
        configured: false,
        connected: false,
        redisUrl: null,
        stats: {
          thumbCount: 0,
          origCount: 0,
          totalDataKeys: 0,
          usedMemoryHuman: null,
          usedMemoryBytes: null,
          maxMemoryHuman: null,
          keyspaceHits: null,
          keyspaceMisses: null,
          hitRate: null,
        },
        sample: [],
      };
      return Response.json(body);
    }

    const redis = getRedisClient();
    if (!redis) return jsonError("Redis client unavailable.", 503);

    // Check connectivity
    let connected = false;
    try {
      await redis.ping();
      connected = true;
    } catch {
      const body: CacheStatsResponse = {
        configured: true,
        connected: false,
        redisUrl: redisUrl.replace(/:[^:@]+@/, ":***@"),
        stats: {
          thumbCount: 0, origCount: 0, totalDataKeys: 0,
          usedMemoryHuman: null, usedMemoryBytes: null, maxMemoryHuman: null,
          keyspaceHits: null, keyspaceMisses: null, hitRate: null,
        },
        sample: [],
      };
      return Response.json(body);
    }

    // Parallel: scan thumb keys, scan orig keys, info memory, info stats
    const [thumbKeys, origKeys, memInfo, statsInfo] = await Promise.all([
      scanKeys(redis, "img:*:thumb:data"),
      scanKeys(redis, "img:*:orig:data"),
      redis.info("memory").catch(() => ""),
      redis.info("stats").catch(() => ""),
    ]);

    const usedMemoryHuman = parseMemoryInfo(memInfo, "used_memory_human");
    const usedMemoryBytes = parseStatsInfo(memInfo, "used_memory");
    const maxMemoryHuman = parseMemoryInfo(memInfo, "maxmemory_human");
    const keyspaceHits = parseStatsInfo(statsInfo, "keyspace_hits");
    const keyspaceMisses = parseStatsInfo(statsInfo, "keyspace_misses");
    const hitRate =
      keyspaceHits !== null && keyspaceMisses !== null && keyspaceHits + keyspaceMisses > 0
        ? Math.round((keyspaceHits / (keyspaceHits + keyspaceMisses)) * 1000) / 10
        : null;

    // Build sample: merge thumb + orig sets into a sha256 map
    const sha256Set = new Map<string, { hasThumb: boolean; hasOrig: boolean }>();
    for (const k of thumbKeys) {
      const sha256 = k.replace(/^img:/, "").replace(/:thumb:data$/, "");
      sha256Set.set(sha256, { ...(sha256Set.get(sha256) ?? { hasThumb: false, hasOrig: false }), hasThumb: true });
    }
    for (const k of origKeys) {
      const sha256 = k.replace(/^img:/, "").replace(/:orig:data$/, "");
      sha256Set.set(sha256, { ...(sha256Set.get(sha256) ?? { hasThumb: false, hasOrig: false }), hasOrig: true });
    }

    // Take first 30 entries and fetch their TTLs in a pipeline
    const sampleEntries = [...sha256Set.entries()].slice(0, 30);
    let sample: CacheStatsResponse["sample"] = [];
    if (sampleEntries.length > 0) {
      const pipe = redis.pipeline();
      for (const [sha256, flags] of sampleEntries) {
        if (flags.hasThumb) pipe.ttl(`img:${sha256}:thumb:data`);
        else pipe.ttl("__missing__");
        if (flags.hasOrig) pipe.ttl(`img:${sha256}:orig:data`);
        else pipe.ttl("__missing__");
      }
      const ttlResults = await pipe.exec();
      sample = sampleEntries.map(([sha256, flags], i) => ({
        sha256,
        hasThumb: flags.hasThumb,
        hasOrig: flags.hasOrig,
        thumbTtl: flags.hasThumb && ttlResults ? (ttlResults[i * 2][1] as number) : null,
        origTtl: flags.hasOrig && ttlResults ? (ttlResults[i * 2 + 1][1] as number) : null,
      }));
    }

    const body: CacheStatsResponse = {
      configured: true,
      connected,
      redisUrl: redisUrl.replace(/:[^:@]+@/, ":***@"),
      stats: {
        thumbCount: thumbKeys.length,
        origCount: origKeys.length,
        totalDataKeys: thumbKeys.length + origKeys.length,
        usedMemoryHuman,
        usedMemoryBytes,
        maxMemoryHuman,
        keyspaceHits,
        keyspaceMisses,
        hitRate,
      },
      sample,
    };
    return Response.json(body);
  });
}

export async function DELETE() {
  return handleRoute(async () => {
    const redis = getRedisClient();
    if (!redis) return jsonError("Redis not configured.", 503);
    // Scan all image cache keys (both :data and :ct variants)
    const allKeys = await scanKeys(redis, "img:*");
    if (allKeys.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < allKeys.length; i += batchSize) {
        await redis.del(...allKeys.slice(i, i + batchSize));
      }
    }
    return Response.json({ deleted: allKeys.length });
  });
}
