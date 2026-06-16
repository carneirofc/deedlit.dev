import Redis from "ioredis";

let _client: Redis | null = null;

export function getRedisClient(): Redis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (_client) return _client;
  _client = new Redis(url, {
    lazyConnect: false,
    // Fail commands immediately when not connected instead of queueing them.
    // With 1, ioredis waits through one full reconnect cycle before rejecting;
    // if the host is unreachable that TCP timeout (20-30 s) blocks every caller.
    maxRetriesPerRequest: 0,
    // Cap the TCP handshake so an unreachable host doesn't block the event loop
    // for the OS-level timeout (~30 s).
    connectTimeout: 3000,
  });
  _client.on("error", () => {/* best-effort cache — ignore connection errors */});
  return _client;
}
