import type { PromptStatistics } from "@/lib/library-types";

const DEFAULT_STATS_CACHE_TTL_MS = 5 * 60 * 1000;

type PromptStatisticsCacheStore = {
  value: PromptStatistics | null;
  expiresAtMs: number;
  inFlight: Promise<PromptStatistics> | null;
  epoch: number;
};

export type PromptStatisticsCacheSnapshot = {
  value: PromptStatistics | null;
  hasValue: boolean;
  isFresh: boolean;
  expiresAtMs: number | null;
  isProcessing: boolean;
};

declare global {
  var __comfyhelperPromptStatisticsCache: PromptStatisticsCacheStore | undefined;
}

function resolveTtlMs(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return override;
  }

  const fromEnv = Number.parseInt(process.env.PROMPT_STATS_CACHE_TTL_MS ?? "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }

  return DEFAULT_STATS_CACHE_TTL_MS;
}

function getStore(): PromptStatisticsCacheStore {
  if (!globalThis.__comfyhelperPromptStatisticsCache) {
    globalThis.__comfyhelperPromptStatisticsCache = {
      value: null,
      expiresAtMs: 0,
      inFlight: null,
      epoch: 0,
    };
  }

  return globalThis.__comfyhelperPromptStatisticsCache;
}

export async function getCachedPromptStatistics(
  loader: () => Promise<PromptStatistics>,
  options?: { ttlMs?: number; forceRefresh?: boolean },
): Promise<PromptStatistics> {
  const snapshot = getPromptStatisticsSnapshot();
  const forceRefresh = options?.forceRefresh === true;

  if (!forceRefresh && snapshot.value && snapshot.isFresh) {
    return snapshot.value;
  }

  const refresh = triggerPromptStatisticsRefresh(loader, options);
  if (refresh.promise) {
    return refresh.promise;
  }

  const cached = getStore().value;
  if (cached) {
    return cached;
  }

  // This should be unreachable unless cache state changes unexpectedly.
  throw new Error("Prompt statistics cache is unavailable.");
}

export function getPromptStatisticsSnapshot(): PromptStatisticsCacheSnapshot {
  const store = getStore();
  const now = Date.now();
  const hasValue = Boolean(store.value);
  const isFresh = hasValue && now < store.expiresAtMs;

  return {
    value: store.value,
    hasValue,
    isFresh,
    expiresAtMs: hasValue ? store.expiresAtMs : null,
    isProcessing: Boolean(store.inFlight),
  };
}

export function triggerPromptStatisticsRefresh(
  loader: () => Promise<PromptStatistics>,
  options?: { ttlMs?: number; forceRefresh?: boolean },
): { started: boolean; promise: Promise<PromptStatistics> | null } {
  const store = getStore();
  const snapshot = getPromptStatisticsSnapshot();
  const ttlMs = resolveTtlMs(options?.ttlMs);
  const forceRefresh = options?.forceRefresh === true;

  if (!forceRefresh && snapshot.isFresh) {
    return { started: false, promise: null };
  }

  if (store.inFlight) {
    return { started: false, promise: store.inFlight };
  }

  const epochAtStart = store.epoch;
  const run = (async () => {
    const stats = await loader();

    // Ignore stale completions if cache was invalidated while loading.
    if (store.epoch === epochAtStart) {
      store.value = stats;
      store.expiresAtMs = Date.now() + ttlMs;
    }

    return stats;
  })().finally(() => {
    if (store.inFlight === run) {
      store.inFlight = null;
    }
  });

  store.inFlight = run;
  return { started: true, promise: run };
}

export function invalidatePromptStatisticsCache(): void {
  const store = getStore();
  store.epoch += 1;
  store.value = null;
  store.expiresAtMs = 0;
}
