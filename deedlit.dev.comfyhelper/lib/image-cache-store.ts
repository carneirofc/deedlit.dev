import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import { prisma, ensureDatabase } from "@/lib/db/client";
import { PromptSummarySchema } from "@/lib/contracts/domain";
import type { Prisma } from "@/lib/generated/prisma/client";
import { readMetadataForImage, walkPngFiles } from "@/lib/library-scanner";
import { tryParseJson, tryParseJsonWithSchema } from "@/lib/json-utils";
import type { ImageRecord, PromptSummary, RootDirectory, ScanJobInfo, ScanJobStatus } from "@/lib/library-types";
import { emitGalleryImagesChanged, emitGalleryImagesRemoved } from "@/lib/messaging/gallery";
import { emitScanEvent } from "@/lib/messaging/scan";
import { invalidatePromptStatisticsCache } from "@/lib/prompt-statistics-cache";
import { extractPromptInsightsFromMetadata } from "@/lib/prompt-statistics";
import { buildGenerationDetails, extractWorkflowDetails } from "@/lib/metadata-utils";

const UPSERT_BATCH_SIZE = 80;
const TOUCH_BATCH_SIZE = 250;
const PROGRESS_UPDATE_EVERY = 20;
const MAX_WARNINGS = 200;
const STATS_METADATA_BATCH_SIZE = 500;
const STATS_VISITOR_YIELD_EVERY = 80;

/**
 * Maximum duration a scan job is allowed to run before it is considered stuck.
 * Jobs older than this are force-failed during stale recovery.
 */
const SCAN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * If a queued/running job has no `startedAtMs` and was created more than this
 * long ago, it is considered abandoned.
 */
const STALE_QUEUED_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

type ScanJobRow = {
  id: string;
  status: string;
  totalFiles: number;
  processedFiles: number;
  cachedImages: number;
  warningsJson: string;
  error: string | null;
  createdAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  updatedAtMs: number;
};
type ImageCacheInsert = Prisma.ImageCacheCreateInput;
type ExistingImageSnapshot = {
  id: string;
  absolutePath: string;
  size: number;
  modifiedAtMs: number;
  metadataJson: string | null;
  promptSummaryJson: string | null;
};

type GlobalScanCoordinator = {
  runningJobId: string | null;
};

declare global {
  var __comfyhelperScanCoordinator: GlobalScanCoordinator | undefined;
}

function getScanCoordinator(): GlobalScanCoordinator {
  if (!globalThis.__comfyhelperScanCoordinator) {
    globalThis.__comfyhelperScanCoordinator = { runningJobId: null };
  }
  return globalThis.__comfyhelperScanCoordinator;
}

function nowMs(): number {
  return Date.now();
}

function toIso(value?: number | null): string | undefined {
  if (!value || !Number.isFinite(value)) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function parseWarnings(raw: string): string[] {
  const parsed = tryParseJson(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((entry): entry is string => typeof entry === "string");
}

function toScanJobInfo(row: ScanJobRow): ScanJobInfo {
  return {
    id: row.id,
    status: row.status as ScanJobStatus,
    totalFiles: row.totalFiles,
    processedFiles: row.processedFiles,
    cachedImages: row.cachedImages,
    warnings: parseWarnings(row.warningsJson),
    error: row.error ?? undefined,
    createdAt: new Date(row.createdAtMs).toISOString(),
    startedAt: toIso(row.startedAtMs),
    finishedAt: toIso(row.finishedAtMs),
  };
}

function parseMetadata(raw: string | null): unknown {
  return tryParseJson(raw);
}

function parsePromptSummary(raw: string | null | undefined): PromptSummary | undefined {
  return tryParseJsonWithSchema(raw, PromptSummarySchema);
}

function toPromptSummaryJson(metadata: unknown): string {
  return JSON.stringify(extractPromptInsightsFromMetadata(metadata));
}

type ImageCacheRecordLike = {
  id: string;
  rootId: string;
  rootPath: string;
  absolutePath: string;
  relativePath: string;
  fileName: string;
  size: number;
  modifiedAt: string;
  metadataPath: string | null;
  metadataError: string | null;
  metadataJson?: string | null;
  promptSummaryJson?: string | null;
};

function toImageRecord(
  row: ImageCacheRecordLike,
  options: {
    includeMetadata?: boolean;
  } = {},
): ImageRecord {
  const parsedPromptSummary = parsePromptSummary(row.promptSummaryJson);
  const parsedMetadata =
    row.metadataJson === undefined ? undefined : parseMetadata(row.metadataJson ?? null);
  const metadata = options.includeMetadata ? parsedMetadata : undefined;
  const fallbackMetadata = parsedPromptSummary === undefined ? parsedMetadata : undefined;

  // Parse metadata on the backend only when includeMetadata is true (detail view)
  // For list endpoints, this is skipped to keep responses lightweight
  let generationDetails = undefined;
  let workflowDetails = undefined;
  if (options.includeMetadata && metadata !== undefined) {
    const tempRecord: ImageRecord = {
      id: row.id,
      rootId: row.rootId,
      rootPath: row.rootPath,
      absolutePath: row.absolutePath,
      relativePath: row.relativePath,
      fileName: row.fileName,
      size: row.size,
      modifiedAt: row.modifiedAt,
      metadata,
      promptSummary: parsedPromptSummary ?? extractPromptInsightsFromMetadata(fallbackMetadata),
    };
    generationDetails = buildGenerationDetails(tempRecord);
    workflowDetails = extractWorkflowDetails(metadata);
  }

  return {
    id: row.id,
    rootId: row.rootId,
    rootPath: row.rootPath,
    absolutePath: row.absolutePath,
    relativePath: row.relativePath,
    fileName: row.fileName,
    size: row.size,
    modifiedAt: row.modifiedAt,
    metadataPath: row.metadataPath ?? undefined,
    metadata,
    metadataError: row.metadataError ?? undefined,
    promptSummary: parsedPromptSummary ?? extractPromptInsightsFromMetadata(fallbackMetadata),
    generationDetails,
    workflowDetails,
  };
}

function appendWarning(warnings: string[], warning: string): void {
  if (warnings.length >= MAX_WARNINGS) {
    return;
  }
  warnings.push(warning);
}

function toMetadataJson(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Convert an insert row to a lightweight ImageRecord suitable for gallery events.
 * Excludes raw metadata to keep SSE payloads small.
 */
function insertToLightImageRecord(row: ImageCacheInsert): ImageRecord {
  return {
    id: row.id,
    rootId: row.rootId,
    rootPath: row.rootPath,
    absolutePath: row.absolutePath,
    relativePath: row.relativePath,
    fileName: row.fileName,
    size: row.size,
    modifiedAt: row.modifiedAt,
    metadataPath: row.metadataPath ?? undefined,
    metadataError: row.metadataError ?? undefined,
    promptSummary: parsePromptSummary(row.promptSummaryJson),
  };
}

async function flushBatch(rows: ImageCacheInsert[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const payload = [...rows];
  rows.length = 0;

  // Use raw SQL INSERT OR REPLACE for true batch operation (much faster than individual upserts)
  const placeholders = payload.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const values = payload.flatMap((row) => [
    row.id,
    row.rootId,
    row.rootPath,
    row.absolutePath,
    row.relativePath,
    row.fileName,
    row.size,
    row.modifiedAtMs,
    row.modifiedAt,
    row.metadataPath,
    row.metadataJson,
    row.promptSummaryJson,
    row.metadataError,
    row.lastSeenJobId,
    row.createdAtMs,
    row.updatedAtMs,
  ]);

  await prisma.$executeRawUnsafe(
    `INSERT OR REPLACE INTO image_cache (
      id, root_id, root_path, absolute_path, relative_path, file_name,
      size, modified_at_ms, modified_at, metadata_path, metadata_json,
      prompt_summary_json, metadata_error, last_seen_job_id,
      created_at_ms, updated_at_ms
    ) VALUES ${placeholders}`,
    ...values,
  );
}

/**
 * Flush upsert batch and emit a gallery event with the inserted/updated images.
 * This enables real-time gallery updates as new images are discovered during a scan.
 */
async function flushBatchWithGalleryEmit(
  rows: ImageCacheInsert[],
  jobId: string,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  // Capture lightweight image records before flush clears the array
  const galleryRecords = rows.map(insertToLightImageRecord);

  await flushBatch(rows);

  emitGalleryImagesChanged({
    images: galleryRecords,
    jobId,
    count: galleryRecords.length,
  });
}

async function flushPromptSummaryBackfill(
  rows: Array<{ id: string; promptSummaryJson: string }>,
  jobId: string,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const payload = [...rows];
  rows.length = 0;
  const timestamp = nowMs();

  // Use raw SQL batch update with CASE statement instead of N individual updates
  // Escape single quotes in JSON strings for SQL safety
  const ids = payload.map((p) => `'${p.id.replace(/'/g, "''")}'`).join(", ");
  const caseStatements = payload
    .map((p) => `WHEN '${p.id.replace(/'/g, "''")}' THEN '${p.promptSummaryJson.replace(/'/g, "''")}'`)
    .join(" ");

  await prisma.$executeRawUnsafe(`
    UPDATE image_cache
    SET
      prompt_summary_json = CASE id ${caseStatements} END,
      last_seen_job_id = '${jobId.replace(/'/g, "''")}',
      updated_at_ms = ${timestamp}
    WHERE id IN (${ids})
  `);
}

async function flushTouchedIds(ids: string[], jobId: string): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  const payload = [...ids];
  ids.length = 0;

  await prisma.imageCache.updateMany({
    where: { id: { in: payload } },
    data: {
      lastSeenJobId: jobId,
      updatedAtMs: nowMs(),
    },
  });
}

async function updateJob(jobId: string, values: Prisma.ScanJobUpdateInput): Promise<void> {
  if (Object.keys(values).length === 0) {
    return;
  }

  await prisma.scanJob.update({
    where: { id: jobId },
    data: {
      ...values,
      updatedAtMs: nowMs(),
    },
  });
}

async function getScanJobRowById(jobId: string): Promise<ScanJobRow | null> {
  return prisma.scanJob.findUnique({ where: { id: jobId } });
}

async function runLibraryScanJob(
  jobId: string,
  roots: RootDirectory[],
  options?: {
    force?: boolean;
  },
): Promise<void> {
  const forceRescan = options?.force === true;
  const startedAtMs = nowMs();
  const rootIds = roots.map((root) => root.id);
  const warnings: string[] = [];
  const upserts: ImageCacheInsert[] = [];
  const touchedIds: string[] = [];
  const promptSummaryBackfillRows: Array<{ id: string; promptSummaryJson: string }> = [];

  let discoveredFiles = 0;
  let processedFiles = 0;
  let reusedFiles = 0;
  let rescannedFiles = 0;
  let newFiles = 0;
  let activeRootPath = roots[0]?.path;

  console.info(`[scan:${jobId}] started roots=${roots.length} at=${new Date(startedAtMs).toISOString()}`);

  const publishProgress = async (status: ScanJobStatus, error?: string) => {
    await updateJob(jobId, {
      totalFiles: discoveredFiles,
      processedFiles,
      cachedImages: processedFiles,
      warningsJson: JSON.stringify(warnings),
      ...(error ? { error } : {}),
    });

    emitScanEvent({
      jobId,
      status,
      processedFiles,
      totalFiles: discoveredFiles,
      cachedImages: processedFiles,
      reusedFiles,
      rescannedFiles,
      newFiles,
      currentRoot: activeRootPath,
      message: `Processed ${processedFiles} / ${discoveredFiles} files`,
      ...(error ? { error } : {}),
    });
  };

  try {
    await updateJob(jobId, {
      status: "running",
      startedAtMs,
      totalFiles: 0,
      processedFiles: 0,
      cachedImages: 0,
      warningsJson: "[]",
      error: null,
      finishedAtMs: null,
    });

    emitScanEvent({
      jobId,
      status: "running",
      processedFiles: 0,
      totalFiles: 0,
      cachedImages: 0,
      reusedFiles: 0,
      rescannedFiles: 0,
      newFiles: 0,
      currentRoot: activeRootPath,
      message: "Scan job started",
    });

    if (rootIds.length === 0) {
      await updateJob(jobId, {
        status: "completed",
        totalFiles: 0,
        processedFiles: 0,
        cachedImages: 0,
        warningsJson: "[]",
        finishedAtMs: nowMs(),
      });
      emitScanEvent({
        jobId,
        status: "completed",
        processedFiles: 0,
        totalFiles: 0,
        cachedImages: 0,
        reusedFiles: 0,
        rescannedFiles: 0,
        newFiles: 0,
        message: "No visible roots to scan",
      });
      invalidatePromptStatisticsCache();
      console.info(`[scan:${jobId}] completed with no roots`);
      return;
    }

    for (const root of roots) {
      activeRootPath = root.path;

      // Load existing images into memory for fast lookup during scan
      // PERFORMANCE NOTE: This loads all cached images for the root into RAM.
      // Alternative approach: Use database lookups per-file with idx_image_cache_root_modified index.
      // Trade-off: Memory (Map overhead) vs CPU (database query per file)
      // Current approach is faster for most cases where unchanged files are common.
      // Consider database lookups only if memory becomes a constraint for very large libraries (50K+ images).
      const existingRows = await prisma.imageCache.findMany({
        where: { rootId: root.id },
        select: {
          id: true,
          absolutePath: true,
          size: true,
          modifiedAtMs: true,
          metadataJson: true,
          promptSummaryJson: true,
        },
      });
      const existingById = new Map<string, ExistingImageSnapshot>(
        existingRows.map((row) => [row.id, row as ExistingImageSnapshot]),
      );

      console.info(
        `[scan:${jobId}] root="${root.path}" cachedSnapshots=${existingRows.length} discovered=${discoveredFiles} processed=${processedFiles}`,
      );

      const shouldStop = await walkPngFiles(
        root.path,
        async (absolutePath) => {
          discoveredFiles += 1;

          let fileStats;
          try {
            fileStats = await stat(absolutePath);
          } catch (error) {
            appendWarning(
              warnings,
              `Could not stat ${absolutePath}: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            processedFiles += 1;
            return false;
          }

          const relativePath = path.relative(root.path, absolutePath).replace(/\\/g, "/");
          const id = `${root.id}:${relativePath}`;
          const existing = existingById.get(id);
          const timestamp = nowMs();
          const modifiedAtMs = Math.trunc(fileStats.mtimeMs);
          const isUnchanged =
            !forceRescan &&
            existing &&
            existing.absolutePath === absolutePath &&
            existing.size === fileStats.size &&
            existing.modifiedAtMs === modifiedAtMs;

          if (isUnchanged) {
            if (!existing.promptSummaryJson) {
              promptSummaryBackfillRows.push({
                id,
                promptSummaryJson: toPromptSummaryJson(parseMetadata(existing.metadataJson)),
              });
            } else {
              touchedIds.push(id);
            }
            reusedFiles += 1;
            processedFiles += 1;
          } else {
            const metadata = await readMetadataForImage(absolutePath);
            upserts.push({
              id,
              rootId: root.id,
              rootPath: root.path,
              absolutePath,
              relativePath,
              fileName: path.basename(absolutePath),
              size: fileStats.size,
              modifiedAtMs,
              modifiedAt: fileStats.mtime.toISOString(),
              metadataPath: metadata.metadataPath ?? null,
              metadataJson: toMetadataJson(metadata.metadata),
              promptSummaryJson: toPromptSummaryJson(metadata.metadata),
              metadataError: metadata.metadataError ?? null,
              lastSeenJobId: jobId,
              createdAtMs: timestamp,
              updatedAtMs: timestamp,
            });
            if (existing) {
              rescannedFiles += 1;
            } else {
              newFiles += 1;
            }
            processedFiles += 1;
          }

          if (upserts.length >= UPSERT_BATCH_SIZE) {
            await flushBatchWithGalleryEmit(upserts, jobId);
          }
          if (touchedIds.length >= TOUCH_BATCH_SIZE) {
            await flushTouchedIds(touchedIds, jobId);
          }
          if (promptSummaryBackfillRows.length >= TOUCH_BATCH_SIZE) {
            await flushPromptSummaryBackfill(promptSummaryBackfillRows, jobId);
          }

          if (processedFiles % PROGRESS_UPDATE_EVERY === 0) {
            await publishProgress("running");
          }

          return false;
        },
        warnings,
      );

      await flushBatchWithGalleryEmit(upserts, jobId);
      await flushTouchedIds(touchedIds, jobId);
      await flushPromptSummaryBackfill(promptSummaryBackfillRows, jobId);

      if (shouldStop) {
        break;
      }
    }

    await flushBatchWithGalleryEmit(upserts, jobId);
    await flushTouchedIds(touchedIds, jobId);
    await flushPromptSummaryBackfill(promptSummaryBackfillRows, jobId);

    // Query stale image IDs before deleting so we can emit removal events
    const staleCondition = {
      rootId: { in: rootIds },
      OR: [
        { lastSeenJobId: { not: jobId } },
        { lastSeenJobId: null },
      ],
    } satisfies Prisma.ImageCacheWhereInput;
    const staleRows = await prisma.imageCache.findMany({
      where: staleCondition,
      select: { id: true },
    });

    await prisma.imageCache.deleteMany({ where: staleCondition });

    // Emit gallery removal event so the frontend can remove stale images immediately
    if (staleRows.length > 0) {
      emitGalleryImagesRemoved({
        removedIds: staleRows.map((r) => r.id),
        jobId,
        count: staleRows.length,
      });
      console.info(
        `[scan:${jobId}] emitted gallery images.removed count=${staleRows.length}`,
      );
    }

    const cachedImages = await prisma.imageCache.count({
      where: { rootId: { in: rootIds } },
    });

    await updateJob(jobId, {
      status: "completed",
      totalFiles: discoveredFiles,
      processedFiles,
      cachedImages,
      warningsJson: JSON.stringify(warnings),
      finishedAtMs: nowMs(),
      error: null,
    });
    emitScanEvent({
      jobId,
      status: "completed",
      processedFiles,
      totalFiles: discoveredFiles,
      cachedImages,
      reusedFiles,
      rescannedFiles,
      newFiles,
      currentRoot: activeRootPath,
      message: "Scan completed",
    });
    invalidatePromptStatisticsCache();
    console.info(
      `[scan:${jobId}] completed discovered=${discoveredFiles} processed=${processedFiles} reused=${reusedFiles} rescanned=${rescannedFiles} new=${newFiles} cached=${cachedImages}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scan failure";
    console.error(`[scan:${jobId}] failed`, error);

    try {
      await updateJob(jobId, {
        status: "failed",
        totalFiles: discoveredFiles,
        processedFiles,
        cachedImages: processedFiles,
        warningsJson: JSON.stringify(warnings),
        finishedAtMs: nowMs(),
        error: message,
      });
    } catch (dbError) {
      console.error(
        `[scan:${jobId}] CRITICAL — failed to mark job as failed in database (job will be recovered as stale)`,
        dbError,
      );
    }

    emitScanEvent({
      jobId,
      status: "failed",
      processedFiles,
      totalFiles: discoveredFiles,
      cachedImages: processedFiles,
      reusedFiles,
      rescannedFiles,
      newFiles,
      currentRoot: activeRootPath,
      message: "Scan failed",
      error: message,
    });
    invalidatePromptStatisticsCache();
  } finally {
    const coordinator = getScanCoordinator();
    if (coordinator.runningJobId === jobId) {
      coordinator.runningJobId = null;
    }
  }
}

async function getActiveScanJobRow(): Promise<ScanJobRow | null> {
  return prisma.scanJob.findFirst({
    where: { status: { in: ["queued", "running"] } },
    orderBy: { createdAtMs: "desc" },
  });
}

/**
 * Recover stale scan jobs that are stuck in "queued" or "running" state.
 * This can happen when the server restarts mid-scan, or when the catch
 * block's DB write itself fails, leaving the DB row orphaned.
 *
 * Called at the start of `startAsyncLibraryScan` to self-heal before
 * checking for active jobs.
 */
async function recoverStaleJobs(): Promise<number> {
  const coordinator = getScanCoordinator();
  const activeInMemory = coordinator.runningJobId;
  const now = nowMs();

  const staleRows = await prisma.scanJob.findMany({
    where: { status: { in: ["queued", "running"] } },
  });

  let recovered = 0;

  for (const row of staleRows) {
    // If this job is the one currently tracked in-memory, check timeout
    if (activeInMemory === row.id) {
      const startedAt = row.startedAtMs ?? row.createdAtMs;
      const elapsed = now - startedAt;
      if (elapsed < SCAN_TIMEOUT_MS) {
        // Still within timeout — leave it running
        continue;
      }
      // Timed out — clear in-memory reference and fall through to force-fail
      coordinator.runningJobId = null;
      console.warn(
        `[scan-recovery] job ${row.id} timed out after ${Math.round(elapsed / 1000)}s — force-failing`,
      );
    } else {
      // Not tracked in-memory — this is an orphan from a previous process or crash
      const age = now - (row.startedAtMs ?? row.createdAtMs);
      const threshold = row.status === "queued" ? STALE_QUEUED_TIMEOUT_MS : SCAN_TIMEOUT_MS;
      if (age < threshold) {
        // Recently created, give it a chance (might be starting up)
        continue;
      }
      console.warn(
        `[scan-recovery] orphaned ${row.status} job ${row.id} (age=${Math.round(age / 1000)}s) — force-failing`,
      );
    }

    try {
      await updateJob(row.id, {
        status: "failed",
        finishedAtMs: now,
        error: `Aborted — stale ${row.status} job recovered (not tracked in current process)`,
      });
      recovered += 1;
    } catch (dbError) {
      console.error(`[scan-recovery] failed to update stale job ${row.id}`, dbError);
    }
  }

  if (recovered > 0) {
    console.info(`[scan-recovery] recovered ${recovered} stale job(s)`);
  }

  return recovered;
}

export async function startAsyncLibraryScan(
  roots: RootDirectory[],
  options?: {
    force?: boolean;
  },
): Promise<{ job: ScanJobInfo; started: boolean }> {
  await ensureDatabase();

  // Self-heal: recover any stale/orphaned jobs before checking for active ones
  await recoverStaleJobs();

  const active = await getActiveScanJobRow();
  if (active) {
    return { job: toScanJobInfo(active), started: false };
  }

  const timestamp = nowMs();
  const jobId = randomUUID();
  await prisma.scanJob.create({
    data: {
      id: jobId,
      status: "queued",
      totalFiles: 0,
      processedFiles: 0,
      cachedImages: 0,
      warningsJson: "[]",
      error: null,
      createdAtMs: timestamp,
      startedAtMs: null,
      finishedAtMs: null,
      updatedAtMs: timestamp,
    },
  });
  emitScanEvent({
    jobId,
    status: "queued",
    processedFiles: 0,
    totalFiles: 0,
    cachedImages: 0,
  });

  const coordinator = getScanCoordinator();
  coordinator.runningJobId = jobId;
  queueMicrotask(() => {
    runLibraryScanJob(jobId, roots, options).catch((error) => {
      console.error(
        `[scan:${jobId}] UNHANDLED — scan promise rejected outside try/catch`,
        error,
      );
      // Ensure in-memory state is always cleared even on unexpected failures
      if (coordinator.runningJobId === jobId) {
        coordinator.runningJobId = null;
      }
    });
  });

  const created = await getScanJobRowById(jobId);
  if (!created) {
    throw new Error("Failed to create scan job.");
  }

  return { job: toScanJobInfo(created), started: true };
}

export async function getLatestScanJob(): Promise<ScanJobInfo | null> {
  await ensureDatabase();

  // Auto-recover stale jobs whenever scan status is queried
  await recoverStaleJobs();

  const active = await getActiveScanJobRow();
  if (active) {
    return toScanJobInfo(active);
  }

  const rows = await prisma.scanJob.findMany({
    orderBy: { createdAtMs: "desc" },
    take: 1,
  });
  if (rows.length === 0) {
    return null;
  }

  return toScanJobInfo(rows[0]);
}

export async function getLatestCompletedScanTime(): Promise<string | null> {
  await ensureDatabase();

  const rows = await prisma.scanJob.findMany({
    where: { status: "completed" },
    orderBy: [{ finishedAtMs: "desc" }, { createdAtMs: "desc" }],
    take: 1,
  });

  if (rows.length === 0) {
    return null;
  }

  const finishedAt = rows[0].finishedAtMs ?? rows[0].updatedAtMs;
  return new Date(finishedAt).toISOString();
}

export async function listCachedImagesByRootIds(rootIds: string[], limit?: number): Promise<ImageRecord[]> {
  await ensureDatabase();

  if (rootIds.length === 0) {
    return [];
  }

  const selectFields = {
    id: true,
    rootId: true,
    rootPath: true,
    absolutePath: true,
    relativePath: true,
    fileName: true,
    size: true,
    modifiedAt: true,
    metadataPath: true,
    metadataJson: true,
    metadataError: true,
    promptSummaryJson: true,
  } satisfies Prisma.ImageCacheSelect;

  const rows = await prisma.imageCache.findMany({
    where: { rootId: { in: rootIds } },
    select: selectFields,
    orderBy: { modifiedAtMs: "desc" },
    ...(typeof limit === "number" && limit > 0 ? { take: limit } : {}),
  });

  return rows.map((row) => toImageRecord(row));
}

export async function getCachedImageById(imageId: string): Promise<ImageRecord | null> {
  await ensureDatabase();

  const row = await prisma.imageCache.findUnique({ where: { id: imageId } });
  if (!row) {
    return null;
  }

  return toImageRecord(row, { includeMetadata: true });
}

function clampBatchSize(size?: number): number {
  if (typeof size !== "number" || !Number.isFinite(size)) {
    return STATS_METADATA_BATCH_SIZE;
  }

  return Math.max(50, Math.min(2000, Math.trunc(size)));
}

function clampYieldEveryRows(size?: number): number {
  if (typeof size !== "number" || !Number.isFinite(size)) {
    return STATS_VISITOR_YIELD_EVERY;
  }

  return Math.max(20, Math.min(2000, Math.trunc(size)));
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function forEachCachedImageMetadataByRootIds(
  rootIds: string[],
  visitor: (metadata: unknown) => void | Promise<void>,
  options?: {
    batchSize?: number;
    yieldEveryRows?: number;
    onBatchProcessed?: (batch: {
      rowsInBatch: number;
      processedTotal: number;
      offset: number;
    }) => void | Promise<void>;
  },
): Promise<number> {
  await ensureDatabase();

  if (rootIds.length === 0) {
    return 0;
  }

  const batchSize = clampBatchSize(options?.batchSize);
  const yieldEveryRows = clampYieldEveryRows(options?.yieldEveryRows);
  let offset = 0;
  let processed = 0;

  while (true) {
    const rows = await prisma.imageCache.findMany({
      where: { rootId: { in: rootIds } },
      select: { metadataJson: true },
      orderBy: { modifiedAtMs: "desc" },
      take: batchSize,
      skip: offset,
    });

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      await visitor(parseMetadata(row.metadataJson ?? null));
      processed += 1;

      if (processed % yieldEveryRows === 0) {
        await yieldToEventLoop();
      }
    }

    if (options?.onBatchProcessed) {
      await options.onBatchProcessed({
        rowsInBatch: rows.length,
        processedTotal: processed,
        offset,
      });
    }

    if (rows.length < batchSize) {
      break;
    }
    offset += rows.length;
  }

  return processed;
}

/**
 * Metadata batch yielded by the streaming metadata generator.
 */
export type MetadataBatch = {
  /** Parsed metadata objects for this batch */
  items: unknown[];
  /** Number of rows in this batch */
  batchSize: number;
  /** Cumulative rows fetched so far (across all batches) */
  processedTotal: number;
  /** The root ID this batch belongs to */
  rootId: string;
  /** Current offset in the root's result set */
  offset: number;
  /** Whether this is the final batch for the current root */
  isLastForRoot: boolean;
  /** Whether this is the final batch across all roots */
  isLast: boolean;
};

/**
 * Async generator that streams metadata batches from the image cache for the
 * given root IDs. Each batch is yielded as soon as it is fetched from the
 * database so that callers can begin processing immediately without waiting
 * for all roots / offsets to complete.
 *
 * Roots are processed in parallel (up to `concurrency` at a time) and their
 * batches are yielded as they arrive.
 */
export async function* streamCachedImageMetadataByRootIds(
  rootIds: string[],
  options?: {
    batchSize?: number;
    concurrency?: number;
  },
): AsyncGenerator<MetadataBatch> {
  await ensureDatabase();

  if (rootIds.length === 0) {
    return;
  }

  const batchSize = clampBatchSize(options?.batchSize);
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? rootIds.length, 8));
  let globalProcessed = 0;
  const startMs = Date.now();

  console.info(
    `[streamMetadata] starting stream roots=${rootIds.length} batchSize=${batchSize} concurrency=${concurrency}`,
  );

  // Generator for a single root – yields MetadataBatch items.
  async function* streamRoot(rootId: string): AsyncGenerator<MetadataBatch> {
    let offset = 0;
    let rootProcessed = 0;
    const rootStartMs = Date.now();

    while (true) {
      const queryStartMs = Date.now();
      const rows = await prisma.imageCache.findMany({
        where: { rootId },
        select: { metadataJson: true },
        orderBy: { modifiedAtMs: "desc" },
        take: batchSize,
        skip: offset,
      });

      const queryMs = Date.now() - queryStartMs;
      if (rows.length === 0) {
        console.info(
          `[streamMetadata] root=${rootId} done totalRows=${rootProcessed} queryMs=${queryMs} rootElapsedMs=${Date.now() - rootStartMs}`,
        );
        break;
      }

      const items = rows.map((row) => parseMetadata(row.metadataJson ?? null));
      rootProcessed += rows.length;
      globalProcessed += rows.length;
      const isLastForRoot = rows.length < batchSize;

      console.info(
        `[streamMetadata] root=${rootId} batch offset=${offset} rows=${rows.length} rootProcessed=${rootProcessed} globalProcessed=${globalProcessed} queryMs=${queryMs}`,
      );

      yield {
        items,
        batchSize: rows.length,
        processedTotal: globalProcessed,
        rootId,
        offset,
        isLastForRoot,
        isLast: false, // caller will set final flag based on completion
      };

      if (isLastForRoot) {
        break;
      }
      offset += rows.length;

      // Yield to event loop between batches
      await yieldToEventLoop();
    }
  }

  // If only one root, stream directly for simplicity
  if (rootIds.length === 1) {
    let lastBatch: MetadataBatch | undefined;
    for await (const batch of streamRoot(rootIds[0])) {
      if (lastBatch) {
        yield lastBatch;
      }
      lastBatch = batch;
    }
    if (lastBatch) {
      yield { ...lastBatch, isLast: true };
    }
    console.info(
      `[streamMetadata] stream complete totalProcessed=${globalProcessed} elapsedMs=${Date.now() - startMs}`,
    );
    return;
  }

  // Multiple roots: process up to `concurrency` roots in parallel.
  // We use a shared queue: each root's generator pushes batches into it.
  type QueueItem = { batch: MetadataBatch } | { done: true };
  const queue: QueueItem[] = [];
  let resolveQueue: (() => void) | null = null;
  let activeGenerators = 0;
  let allSpawned = false;

  function notifyQueue() {
    if (resolveQueue) {
      const fn = resolveQueue;
      resolveQueue = null;
      fn();
    }
  }

  async function consumeRoot(rootId: string) {
    activeGenerators += 1;
    try {
      for await (const batch of streamRoot(rootId)) {
        queue.push({ batch });
        notifyQueue();
      }
    } catch (error) {
      console.error(`[streamMetadata] root=${rootId} error`, error);
    } finally {
      activeGenerators -= 1;
      if (activeGenerators === 0 && allSpawned) {
        queue.push({ done: true });
      }
      notifyQueue();
    }
  }

  // Launch root consumers in waves of `concurrency`
  const rootQueue = [...rootIds];
  let inFlight = 0;

  function spawnNext() {
    while (inFlight < concurrency && rootQueue.length > 0) {
      const rootId = rootQueue.shift()!;
      inFlight += 1;
      consumeRoot(rootId).finally(() => {
        inFlight -= 1;
        spawnNext();
      });
    }
    if (rootQueue.length === 0) {
      allSpawned = true;
      if (activeGenerators === 0) {
        queue.push({ done: true });
        notifyQueue();
      }
    }
  }

  spawnNext();

  // Yield batches as they arrive
  let lastBatch: MetadataBatch | undefined;
  while (true) {
    while (queue.length === 0) {
      await new Promise<void>((resolve) => {
        resolveQueue = resolve;
      });
    }

    const item = queue.shift()!;
    if ("done" in item) {
      break;
    }

    if (lastBatch) {
      yield lastBatch;
    }
    lastBatch = item.batch;
  }

  if (lastBatch) {
    yield { ...lastBatch, isLast: true };
  }

  console.info(
    `[streamMetadata] stream complete totalProcessed=${globalProcessed} elapsedMs=${Date.now() - startMs}`,
  );
}

export async function queryCachedImagesByRootIds(
  rootIds: string[],
  options: {
    search?: string;
    page: number;
    pageSize: number;
  },
): Promise<{ images: ImageRecord[]; total: number }> {
  await ensureDatabase();

  if (rootIds.length === 0) {
    return { images: [], total: 0 };
  }

  const trimmedSearch = options.search?.trim();
  const baseCondition: Prisma.ImageCacheWhereInput = { rootId: { in: rootIds } };
  const searchCondition: Prisma.ImageCacheWhereInput | undefined = trimmedSearch
    ? {
        OR: [
          { fileName: { contains: trimmedSearch } },
          { relativePath: { contains: trimmedSearch } },
          { absolutePath: { contains: trimmedSearch } },
        ],
      }
    : undefined;
  const whereClause: Prisma.ImageCacheWhereInput = searchCondition
    ? { AND: [baseCondition, searchCondition] }
    : baseCondition;

  const safePage = Math.max(1, options.page);
  const safePageSize = Math.max(1, Math.min(200, options.pageSize));
  const offset = (safePage - 1) * safePageSize;
  const selectFields = {
    id: true,
    rootId: true,
    rootPath: true,
    absolutePath: true,
    relativePath: true,
    fileName: true,
    size: true,
    modifiedAt: true,
    metadataPath: true,
    metadataJson: true,
    metadataError: true,
    promptSummaryJson: true,
  } satisfies Prisma.ImageCacheSelect;

  const [rows, total] = await Promise.all([
    prisma.imageCache.findMany({
      where: whereClause,
      select: selectFields,
      orderBy: { modifiedAtMs: "desc" },
      take: safePageSize,
      skip: offset,
    }),
    prisma.imageCache.count({ where: whereClause }),
  ]);

  return {
    images: rows.map((row) => toImageRecord(row)),
    total,
  };
}

export async function countCachedImagesByRootIds(rootIds: string[]): Promise<number> {
  await ensureDatabase();

  if (rootIds.length === 0) {
    return 0;
  }

  return prisma.imageCache.count({
    where: { rootId: { in: rootIds } },
  });
}

export async function removeCachedImagesForRoot(rootId: string): Promise<void> {
  await ensureDatabase();
  await prisma.imageCache.deleteMany({ where: { rootId } });
  invalidatePromptStatisticsCache();
}

export async function removeCachedImageEntry(imageId: string): Promise<boolean> {
  await ensureDatabase();

  const row = await prisma.imageCache.findUnique({
    where: { id: imageId },
    select: { id: true },
  });
  if (!row) {
    return false;
  }

  await prisma.imageCache.deleteMany({ where: { id: imageId } });

  emitGalleryImagesRemoved({
    removedIds: [imageId],
    count: 1,
  });
  invalidatePromptStatisticsCache();
  return true;
}

export async function removeCachedImageEntriesByAbsolutePath(absolutePath: string): Promise<number> {
  await ensureDatabase();

  // Use single DELETE query instead of N+1 pattern (find then delete)
  // Note: SQLite 3.35+ supports RETURNING clause, but better-sqlite3 may not expose it via Prisma
  // So we'll keep the two-query approach but document it for future optimization
  const rows = await prisma.imageCache.findMany({
    where: { absolutePath },
    select: { id: true },
  });

  if (rows.length === 0) {
    return 0;
  }

  const removedIds = rows.map((row) => row.id);
  await prisma.imageCache.deleteMany({
    where: { id: { in: removedIds } },
  });

  emitGalleryImagesRemoved({
    removedIds,
    count: removedIds.length,
  });
  invalidatePromptStatisticsCache();

  return removedIds.length;
}
