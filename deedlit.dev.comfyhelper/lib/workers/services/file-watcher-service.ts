import { stat } from "node:fs/promises";
import path from "node:path";

import { listRoots } from "@/lib/config-store";
import type { FileChangeSet, FileFingerprint } from "@/lib/contracts/worker";
import { walkPngFiles } from "@/lib/library-scanner";
import type { RootDirectory } from "@/lib/library-types";
import type { BackgroundService, ServiceContext, ServiceHealth } from "@/lib/workers/worker-types";

const SERVICE_NAME = "file-watcher";
const CHANNEL = "file-watcher" as const;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MIN_POLL_INTERVAL_MS = 5_000;

export type { FileChangeSet, FileFingerprint };

type SnapshotDiff = Pick<FileChangeSet, "added" | "modified" | "removed">;

function nowIso(): string {
  return new Date().toISOString();
}

export class FileWatcherService implements BackgroundService {
  readonly name = SERVICE_NAME;

  private ctx: ServiceContext | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pollIntervalMs: number;

  private knownFiles = new Map<string, FileFingerprint>();
  private pollCount = 0;
  private lastPollAt: string | null = null;
  private lastChangeAt: string | null = null;
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private running = false;

  constructor(options?: { pollIntervalMs?: number }) {
    this.pollIntervalMs = Math.max(
      MIN_POLL_INTERVAL_MS,
      options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
  }

  async start(ctx: ServiceContext): Promise<void> {
    this.ctx = ctx;
    this.running = true;
    this.startedAt = nowIso();
    this.stoppedAt = null;

    await this.seedInitialSnapshot();
    this.schedulePoll();

    ctx.emit(CHANNEL, "watcher.started", {
      pollIntervalMs: this.pollIntervalMs,
      knownFiles: this.knownFiles.size,
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stoppedAt = nowIso();
    this.clearPollTimer();
    this.ctx = null;
  }

  health(): ServiceHealth {
    return {
      name: this.name,
      status: this.running ? "running" : "stopped",
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      details: {
        pollIntervalMs: this.pollIntervalMs,
        knownFiles: this.knownFiles.size,
        pollCount: this.pollCount,
        lastPollAt: this.lastPollAt,
        lastChangeAt: this.lastChangeAt,
      },
    };
  }

  private clearPollTimer(): void {
    if (!this.pollTimer) {
      return;
    }

    clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private schedulePoll(): void {
    if (!this.running || !this.ctx) {
      return;
    }

    this.clearPollTimer();
    this.pollTimer = setTimeout(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    if (!this.running || !this.ctx) {
      return;
    }

    const ctx = this.ctx;
    const pollStartedAt = Date.now();

    try {
      const roots = await listRoots({ visibleOnly: true });
      this.pollCount += 1;
      this.lastPollAt = nowIso();

      if (roots.length > 0) {
        const currentFiles = await this.collectFingerprints(roots);
        const changes = this.diffSnapshots(currentFiles, roots);
        const totalChanges =
          changes.added.length + changes.modified.length + changes.removed.length;

        if (totalChanges > 0) {
          this.lastChangeAt = nowIso();

          ctx.emit(CHANNEL, "files.changed", {
            ...changes,
            rootIds: roots.map((root) => root.id),
            totalKnown: this.knownFiles.size,
            pollDurationMs: Date.now() - pollStartedAt,
          } satisfies FileChangeSet);
        }
      }
    } catch (error) {
      ctx.logger.error("poll failed", error);
      ctx.emit(CHANNEL, "watcher.error", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.schedulePoll();
    }
  }

  private async seedInitialSnapshot(): Promise<void> {
    if (!this.ctx) {
      return;
    }

    try {
      const roots = await listRoots({ visibleOnly: true });
      this.knownFiles = await this.collectFingerprints(roots);
      this.ctx.logger.info(`seeded ${this.knownFiles.size} tracked files`);
    } catch (error) {
      this.ctx.logger.error("failed to seed watcher snapshot", error);
    }
  }

  private async collectFingerprints(
    roots: RootDirectory[],
  ): Promise<Map<string, FileFingerprint>> {
    const fingerprints = new Map<string, FileFingerprint>();
    const warnings: string[] = [];

    for (const root of roots) {
      if (this.ctx?.signal.aborted) {
        break;
      }

      await walkPngFiles(
        root.path,
        async (absolutePath) => {
          if (this.ctx?.signal.aborted) {
            return true;
          }

          try {
            const fileStats = await stat(absolutePath);
            const relativePath = path.relative(root.path, absolutePath).replace(/\\/g, "/");
            const id = `${root.id}:${relativePath}`;

            fingerprints.set(id, {
              absolutePath,
              relativePath,
              rootId: root.id,
              size: fileStats.size,
              modifiedAtMs: Math.trunc(fileStats.mtimeMs),
            });
          } catch {
            // Ignore files that disappear between directory walk and stat.
          }

          return false;
        },
        warnings,
      );
    }

    return fingerprints;
  }

  private diffSnapshots(
    current: Map<string, FileFingerprint>,
    roots: RootDirectory[],
  ): SnapshotDiff {
    const activeRootIds = new Set(roots.map((root) => root.id));
    const added: FileFingerprint[] = [];
    const modified: FileFingerprint[] = [];
    const removed: FileFingerprint[] = [];

    for (const [id, fingerprint] of current) {
      const known = this.knownFiles.get(id);
      if (!known) {
        added.push(fingerprint);
        continue;
      }

      if (known.size !== fingerprint.size || known.modifiedAtMs !== fingerprint.modifiedAtMs) {
        modified.push(fingerprint);
      }
    }

    for (const [id, fingerprint] of this.knownFiles) {
      if (activeRootIds.has(fingerprint.rootId) && !current.has(id)) {
        removed.push(fingerprint);
      }
    }

    this.knownFiles = current;
    return { added, modified, removed };
  }
}
