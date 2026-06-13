import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { getLogger } from "@/lib/logger";
import { maybeRow, query } from "@/lib/library/db/postgres";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import {
  SUPPORTED_EXTENSIONS,
  computeSha256,
  extractImageMetadata,
} from "@/lib/library/services/metadata-service";
import { findById, findBySha256, persistImage } from "@/lib/library/repositories/image-repository";
import type { ReindexRequest } from "@/lib/library/schemas";
import { generateThumbnail } from "@/lib/library/services/thumbnail-service";
import { upsertImageVector } from "@/lib/library/services/qdrant-service";
import { syncImageToGraph } from "@/lib/library/services/graph-service";
import { enrichImageMetadata } from "@/lib/library/services/enrichment-service";
import type { IngestFolderRequest } from "@/lib/library/schemas";

const logger = getLogger({ scope: "library-ingest" });

async function* walk(dir: string, recursive: boolean): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) yield* walk(full, recursive);
    } else if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield full;
    }
  }
}

export async function createIngestionJob(req: IngestFolderRequest): Promise<string> {
  await ensureLibrarySchema();
  const row = await maybeRow<{ id: string }>(
    `INSERT INTO ingestion_jobs (folder_path, status, config_json, started_at)
     VALUES ($1, 'running', $2, now()) RETURNING id`,
    [req.folderPath, JSON.stringify(req)],
  );
  return row!.id;
}

async function recordFile(
  jobId: string,
  filePath: string,
  status: string,
  error: string | null,
  imageId: string | null,
): Promise<void> {
  await query(
    `INSERT INTO ingestion_job_files (job_id, file_path, status, error, image_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [jobId, filePath, status, error, imageId],
  );
}

/** Process a single image file through the full pipeline. */
export async function ingestSingleFile(
  filePath: string,
  req: IngestFolderRequest,
): Promise<{ imageId: string; skipped: boolean }> {
  const sha = await computeSha256(filePath);
  const existing = await findBySha256(sha);
  if (existing) {
    return { imageId: existing.id, skipped: true };
  }

  const record = await extractImageMetadata(filePath);

  let thumbnailPath: string | null = null;
  if (req.generateThumbnails) {
    try {
      thumbnailPath = await generateThumbnail(filePath, record.sha256Hash, "medium");
    } catch (error) {
      logger.warn({ err: error, filePath }, "thumbnail generation failed");
    }
  }

  const imageId = await persistImage(record, thumbnailPath);

  if (req.indexQdrant) {
    await upsertImageVector(imageId).catch((error) => logger.warn({ err: error, imageId }, "qdrant index failed"));
  }
  if (req.syncNeo4j) {
    await syncImageToGraph(imageId).catch((error) => logger.warn({ err: error, imageId }, "neo4j sync failed"));
  }
  if (req.runExternalEnrichment) {
    await enrichImageMetadata(imageId).catch((error) => logger.warn({ err: error, imageId }, "enrichment failed"));
  }

  return { imageId, skipped: false };
}

/** Run the ingestion job to completion; updates job counters as it goes. */
export async function runIngestionJob(jobId: string, req: IngestFolderRequest): Promise<void> {
  let total = 0;
  let processed = 0;
  let failed = 0;

  try {
    const folderStat = await stat(req.folderPath).catch(() => null);
    if (!folderStat || !folderStat.isDirectory()) {
      throw new Error(`folder_path is not a directory: ${req.folderPath}`);
    }

    for await (const filePath of walk(req.folderPath, req.recursive)) {
      total++;
      try {
        const { imageId, skipped } = await ingestSingleFile(filePath, req);
        processed++;
        await recordFile(jobId, filePath, skipped ? "skipped" : "indexed", null, imageId);
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        await recordFile(jobId, filePath, "failed", message, null);
        logger.warn({ err: error, filePath }, "ingest file failed");
      }
      if (total % 20 === 0) {
        await query(
          `UPDATE ingestion_jobs SET total_files=$2, processed_files=$3, failed_files=$4 WHERE id=$1`,
          [jobId, total, processed, failed],
        );
      }
    }

    await query(
      `UPDATE ingestion_jobs
         SET status='completed', total_files=$2, processed_files=$3, failed_files=$4, finished_at=now()
       WHERE id=$1`,
      [jobId, total, processed, failed],
    );
    logger.info({ jobId, total, processed, failed }, "ingestion job completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(
      `UPDATE ingestion_jobs SET status='failed', error_message=$2, finished_at=now() WHERE id=$1`,
      [jobId, message],
    );
    logger.error({ err: error, jobId }, "ingestion job failed");
  }
}

/**
 * Re-extract metadata and refresh the graph/vector projections for one image.
 * Re-reads the original file from disk so edits to the file are picked up.
 */
export async function reindexImage(req: ReindexRequest): Promise<{ imageId: string } | null> {
  const existing = await findById(req.imageId);
  if (!existing) return null;

  if (req.refreshMetadata) {
    const record = await extractImageMetadata(existing.file_path);
    let thumbnailPath = existing.thumbnail_path;
    try {
      thumbnailPath = await generateThumbnail(existing.file_path, record.sha256Hash, "medium");
    } catch (error) {
      logger.warn({ err: error, imageId: req.imageId }, "reindex thumbnail failed");
    }
    await persistImage(record, thumbnailPath);
  }
  if (req.refreshQdrant) {
    await upsertImageVector(req.imageId).catch((error) => logger.warn({ err: error }, "reindex qdrant failed"));
  }
  if (req.refreshGraph) {
    await syncImageToGraph(req.imageId).catch((error) => logger.warn({ err: error }, "reindex graph failed"));
  }
  if (req.runExternalEnrichment) {
    await enrichImageMetadata(req.imageId).catch((error) => logger.warn({ err: error }, "reindex enrichment failed"));
  }
  return { imageId: req.imageId };
}

/** Kick off a job and return its id immediately (fire-and-forget execution). */
export async function startIngestion(req: IngestFolderRequest): Promise<string> {
  const jobId = await createIngestionJob(req);
  // Intentionally not awaited: the HTTP handler returns immediately.
  void runIngestionJob(jobId, req);
  return jobId;
}
