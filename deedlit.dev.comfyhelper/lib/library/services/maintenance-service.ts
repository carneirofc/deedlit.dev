import { access } from "node:fs/promises";

import { getLogger } from "@/lib/logger";
import { query, rows } from "@/lib/library/db/postgres";
import { listAllForReindex } from "@/lib/library/repositories/image-repository";
import { rebuildGraph } from "@/lib/library/services/graph-service";
import { rebuildQdrant } from "@/lib/library/services/qdrant-service";
import { generateThumbnail } from "@/lib/library/services/thumbnail-service";
import { setThumbnail } from "@/lib/library/repositories/image-repository";

const logger = getLogger({ scope: "library-maintenance" });

export async function rebuildNeo4j(): Promise<{ synced: number }> {
  return rebuildGraph();
}

export async function rebuildVectors(): Promise<{ indexed: number; skipped: number; failed: number }> {
  const all = await listAllForReindex();
  return rebuildQdrant(all);
}

/** Detect images whose original file no longer exists; mark them deleted. */
export async function rescanFiles(): Promise<{ checked: number; missing: number }> {
  const all = await listAllForReindex();
  let missing = 0;
  for (const img of all) {
    try {
      await access(img.filePath);
    } catch {
      missing++;
      await query(`UPDATE images SET deleted = true, ingestion_status = 'missing' WHERE id = $1`, [img.id]);
    }
  }
  return { checked: all.length, missing };
}

/** Regenerate thumbnails for any image missing one. */
export async function regenerateThumbnails(): Promise<{ generated: number; failed: number }> {
  const targets = await rows<{ id: string; filePath: string; sha256: string }>(
    `SELECT id, file_path AS "filePath", sha256_hash AS sha256
       FROM images WHERE deleted = false AND thumbnail_path IS NULL`,
  );
  let generated = 0;
  let failed = 0;
  for (const t of targets) {
    try {
      const thumb = await generateThumbnail(t.filePath, t.sha256, "medium");
      await setThumbnail(t.id, thumb);
      generated++;
    } catch (error) {
      failed++;
      logger.warn({ err: error, imageId: t.id }, "thumbnail regeneration failed");
    }
  }
  return { generated, failed };
}
