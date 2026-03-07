import { listRoots } from "@/lib/config-store";
import { FileChangeSetSchema, type FileChangeSet } from "@/lib/contracts/worker";
import { startAsyncLibraryScan } from "@/lib/image-cache-store";
import type { BackgroundService, ServiceContext, ServiceHealth, WorkerEvent } from "@/lib/workers/worker-types";

const SERVICE_NAME = "scan-coordinator";
const CHANNEL = "scan-coordinator" as const;
const WATCHER_CHANNEL = "file-watcher" as const;

const DEFAULT_DEBOUNCE_MS = 5_000;
const MIN_DEBOUNCE_MS = 1_000;
const DEFAULT_COOLDOWN_MS = 15_000;

function nowIso(): string {
  return new Date().toISOString();
}

export class ScanCoordinatorService implements BackgroundService {
  readonly name = SERVICE_NAME;

  private ctx: ServiceContext | null = null;
  private readonly debounceMs: number;
  private readonly cooldownMs: number;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastScanTriggeredAt = 0;
  private pendingBatches = 0;
  private pendingChangeSet: FileChangeSet | null = null;
  private scansTriggered = 0;
  private scansSkipped = 0;
  private lastChangeEvent: FileChangeSet | null = null;
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private running = false;

  constructor(options?: { debounceMs?: number; cooldownMs?: number }) {
    this.debounceMs = Math.max(MIN_DEBOUNCE_MS, options?.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.cooldownMs = Math.max(0, options?.cooldownMs ?? DEFAULT_COOLDOWN_MS);
  }

  async start(ctx: ServiceContext): Promise<void> {
    this.ctx = ctx;
    this.running = true;
    this.startedAt = nowIso();
    this.stoppedAt = null;

    ctx.subscribeKind(WATCHER_CHANNEL, "files.changed", (event: WorkerEvent) => {
      const parsed = FileChangeSetSchema.safeParse(event.payload);
      if (!parsed.success) {
        ctx.logger.warn("ignoring malformed files.changed payload", parsed.error.flatten());
        return;
      }
      this.onFilesChanged(parsed.data);
    });

    ctx.emit(CHANNEL, "coordinator.started", {
      debounceMs: this.debounceMs,
      cooldownMs: this.cooldownMs,
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stoppedAt = nowIso();
    this.clearDebounceTimer();
    this.ctx = null;
  }

  health(): ServiceHealth {
    return {
      name: this.name,
      status: this.running ? "running" : "stopped",
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      details: {
        debounceMs: this.debounceMs,
        cooldownMs: this.cooldownMs,
        pendingBatches: this.pendingBatches,
        scansTriggered: this.scansTriggered,
        scansSkipped: this.scansSkipped,
        lastScanTriggeredAt: this.lastScanTriggeredAt
          ? new Date(this.lastScanTriggeredAt).toISOString()
          : null,
        lastChangeEvent: this.lastChangeEvent
          ? {
              added: this.lastChangeEvent.added.length,
              modified: this.lastChangeEvent.modified.length,
              removed: this.lastChangeEvent.removed.length,
            }
          : null,
      },
    };
  }

  private clearDebounceTimer(): void {
    if (!this.debounceTimer) {
      return;
    }

    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private onFilesChanged(changeSet: FileChangeSet): void {
    if (!this.running || !this.ctx) {
      return;
    }

    this.lastChangeEvent = changeSet;
    this.pendingChangeSet = changeSet;
    this.pendingBatches += 1;

    this.clearDebounceTimer();
    this.debounceTimer = setTimeout(() => {
      void this.triggerScan();
    }, this.debounceMs);
  }

  private async triggerScan(): Promise<void> {
    if (!this.running || !this.ctx || !this.pendingChangeSet) {
      return;
    }

    const ctx = this.ctx;
    const changeSet = this.pendingChangeSet;
    const pendingBatches = this.pendingBatches;
    this.pendingChangeSet = null;

    const now = Date.now();
    const elapsed = now - this.lastScanTriggeredAt;
    if (this.lastScanTriggeredAt > 0 && elapsed < this.cooldownMs) {
      this.scansSkipped += 1;
      this.pendingBatches = 0;
      ctx.emit(CHANNEL, "scan.skipped", { reason: "cooldown" });
      return;
    }

    try {
      const roots = await listRoots({ visibleOnly: true });
      if (roots.length === 0) {
        this.pendingBatches = 0;
        return;
      }

      ctx.emit(CHANNEL, "scan.triggering", {
        added: changeSet.added.length,
        modified: changeSet.modified.length,
        removed: changeSet.removed.length,
        pendingBatches,
      });

      const { job, started } = await startAsyncLibraryScan(roots);
      this.lastScanTriggeredAt = Date.now();
      this.pendingBatches = 0;

      if (started) {
        this.scansTriggered += 1;
        ctx.emit(CHANNEL, "scan.triggered", { jobId: job.id });
        return;
      }

      this.scansSkipped += 1;
      ctx.emit(CHANNEL, "scan.skipped", {
        reason: "already-running",
        jobId: job.id,
        jobStatus: job.status,
      });
    } catch (error) {
      this.pendingBatches = 0;
      ctx.logger.error("failed to trigger scan", error);
      ctx.emit(CHANNEL, "coordinator.error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
