import { getSettings, listRoots } from "@/lib/config-store";
import { streamCachedImageMetadataByRootIds } from "@/lib/image-cache-store";
import type { PromptStatistics } from "@/lib/library-types";
import {
  createPromptStatisticsAccumulator,
  finalizePromptStatistics,
  streamPromptStatistics,
} from "@/lib/prompt-statistics";
import {
  getPromptStatisticsSnapshot,
  invalidatePromptStatisticsCache,
  triggerPromptStatisticsRefresh,
} from "@/lib/prompt-statistics-cache";
import type { BackgroundService, ServiceContext, ServiceHealth } from "@/lib/workers/worker-types";
import { getLogger } from "../../logger";

const SERVICE_NAME = "stats-worker";
const logger = getLogger({ service: SERVICE_NAME });

// How long to wait after a scan completes before recomputing stats.
const RECOMPUTE_DEBOUNCE_MS = 3_000;

// Channels/kinds that should trigger a stats recompute.
const INVALIDATING_KINDS: ReadonlySet<string> = new Set([
  "scan.completed",
  "scan.failed",
]);

function nowIso(): string {
  return new Date().toISOString();
}

export async function computePromptStatistics(requestId: string): Promise<PromptStatistics> {
  const loaderStartedAt = Date.now();

  const [roots, settings] = await Promise.all([listRoots({ visibleOnly: true }), getSettings()]);

  const rootIds = roots.map((root) => root.id);
  const metadataStream = streamCachedImageMetadataByRootIds(rootIds, {
    batchSize: 200,
    concurrency: Math.min(Math.max(roots.length, 1), 4),
  });
  const statsStream = streamPromptStatistics(metadataStream, {
    excludedTags: settings.excludedTags,
  });

  let finalized: PromptStatistics | undefined;

  for await (const event of statsStream) {
    if (event.type === "complete") {
      finalized = event.stats;
    }
  }

  if (!finalized) {
    finalized = finalizePromptStatistics(
      createPromptStatisticsAccumulator({ excludedTags: settings.excludedTags }),
    );
  }

  logger.info(
    { requestId, elapsedMs: Date.now() - loaderStartedAt, totalImages: finalized.totalImages },
    "Prompt statistics computed",
  );

  return finalized;
}

export class StatsWorkerService implements BackgroundService {
  readonly name = SERVICE_NAME;

  private ctx: ServiceContext | null = null;
  private running = false;
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private lastComputedAt: string | null = null;
  private computeCount = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async start(ctx: ServiceContext): Promise<void> {
    this.ctx = ctx;
    this.running = true;
    this.startedAt = nowIso();
    this.stoppedAt = null;

    // Trigger an initial warm-up if the cache is cold.
    this.scheduleRecompute("startup", 0);

    // Recompute after scans complete (debounced).
    ctx.subscribeKind("scan", "scan.completed", () => {
      invalidatePromptStatisticsCache();
      this.scheduleRecompute("scan.completed", RECOMPUTE_DEBOUNCE_MS);
    });

    ctx.subscribeKind("scan", "scan.failed", () => {
      this.scheduleRecompute("scan.failed", RECOMPUTE_DEBOUNCE_MS);
    });

    ctx.logger.info("started");
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stoppedAt = nowIso();
    this.clearDebounceTimer();
    this.ctx = null;
    logger.info("Stats worker stopped");
  }

  health(): ServiceHealth {
    const snapshot = getPromptStatisticsSnapshot();
    return {
      name: this.name,
      status: this.running ? "running" : "stopped",
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      details: {
        computeCount: this.computeCount,
        lastComputedAt: this.lastComputedAt,
        cacheHasValue: snapshot.hasValue,
        cacheFresh: snapshot.isFresh,
        cacheExpiresAt: snapshot.expiresAtMs
          ? new Date(snapshot.expiresAtMs).toISOString()
          : null,
        isProcessing: snapshot.isProcessing,
      },
    };
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private scheduleRecompute(reason: string, delayMs: number): void {
    if (!this.running) return;

    this.clearDebounceTimer();

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.running) return;
      this.runRecompute(reason);
    }, delayMs);
  }

  private runRecompute(reason: string): void {
    const snapshot = getPromptStatisticsSnapshot();

    // Skip if already computing or if cache is still fresh.
    if (snapshot.isProcessing) {
      logger.info({ reason }, "Recompute skipped because a run is already in progress");
      return;
    }

    if (snapshot.isFresh && reason !== "startup") {
      logger.info({ reason }, "Recompute skipped because cache is still fresh");
      return;
    }

    const requestId = `sw:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
    logger.info({ reason, requestId }, "Starting recompute");

    const refresh = triggerPromptStatisticsRefresh(
      () => computePromptStatistics(requestId),
      { forceRefresh: true },
    );

    if (refresh.promise) {
      this.computeCount += 1;
      void refresh.promise
        .then(() => {
          this.lastComputedAt = nowIso();
          logger.info({ requestId }, "Recompute complete");
        })
        .catch((error) => {
          logger.error({ requestId, err: error }, "Recompute failed");
        });
    }
  }
}
