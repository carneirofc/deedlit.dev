import { maybeRow, query, rows, withTransaction } from "@/lib/library/db/postgres";
import type { ExtractedImageRecord } from "@/lib/library/services/metadata-service";
import {
  inferModelFamily,
  linkImageLora,
  upsertCheckpoint,
  upsertLora,
  upsertModel,
} from "@/lib/library/repositories/model-repository";
import { clearImageTags, linkImageTag, upsertTag } from "@/lib/library/repositories/tag-repository";
import type { ImageDetail, SearchFilters } from "@/lib/library/schemas";

interface ImageRowLite {
  id: string;
  sha256_hash: string;
  file_path: string;
  thumbnail_path: string | null;
  filename: string;
  ingestion_status: string;
}

export async function findBySha256(sha256: string): Promise<ImageRowLite | null> {
  return maybeRow<ImageRowLite>(
    `SELECT id, sha256_hash, file_path, thumbnail_path, filename, ingestion_status
       FROM images WHERE sha256_hash = $1`,
    [sha256],
  );
}

export async function findById(id: string): Promise<ImageRowLite | null> {
  return maybeRow<ImageRowLite>(
    `SELECT id, sha256_hash, file_path, thumbnail_path, filename, ingestion_status
       FROM images WHERE id = $1`,
    [id],
  );
}

/**
 * Persist a fully-extracted image record plus its tags, loras, model,
 * checkpoint and generation params in a single transaction.  Idempotent on
 * sha256: an existing row is updated rather than duplicated.
 */
export async function persistImage(
  record: ExtractedImageRecord,
  thumbnailPath: string | null,
): Promise<string> {
  return withTransaction(async (client) => {
    let modelId: string | null = null;
    let checkpointId: string | null = null;
    if (record.model) {
      const family = inferModelFamily(record.model);
      modelId = await upsertModel(client, record.model, family);
      checkpointId = await upsertCheckpoint(client, record.model, modelId);
    }

    const upsert = await client.query<{ id: string }>(
      `INSERT INTO images (
         file_path, thumbnail_path, filename, extension, sha256_hash, perceptual_hash,
         width, height, file_size_bytes, created_at, modified_at, source_tool,
         prompt, negative_prompt, workflow_json, metadata_json, model_id, checkpoint_id,
         ingestion_status
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'indexed'
       )
       ON CONFLICT (sha256_hash) DO UPDATE SET
         file_path = EXCLUDED.file_path,
         thumbnail_path = COALESCE(EXCLUDED.thumbnail_path, images.thumbnail_path),
         perceptual_hash = EXCLUDED.perceptual_hash,
         width = EXCLUDED.width,
         height = EXCLUDED.height,
         prompt = EXCLUDED.prompt,
         negative_prompt = EXCLUDED.negative_prompt,
         workflow_json = EXCLUDED.workflow_json,
         metadata_json = EXCLUDED.metadata_json,
         source_tool = EXCLUDED.source_tool,
         model_id = COALESCE(EXCLUDED.model_id, images.model_id),
         checkpoint_id = COALESCE(EXCLUDED.checkpoint_id, images.checkpoint_id),
         modified_at = EXCLUDED.modified_at,
         ingestion_status = 'indexed'
       RETURNING id`,
      [
        record.filePath,
        thumbnailPath,
        record.filename,
        record.extension,
        record.sha256Hash,
        record.perceptualHash,
        record.width,
        record.height,
        record.fileSizeBytes,
        record.createdAt,
        record.modifiedAt,
        record.sourceTool,
        record.prompt,
        record.negativePrompt,
        record.workflowJson ? JSON.stringify(record.workflowJson) : null,
        record.metadataJson ? JSON.stringify(record.metadataJson) : null,
        modelId,
        checkpointId,
      ],
    );
    const imageId = upsert.rows[0].id;

    // Generation params (1:1).
    const gp = record.generationParams;
    await client.query(
      `INSERT INTO generation_params (image_id, seed, steps, cfg_scale, sampler, scheduler, denoise, width, height, clip_skip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (image_id) DO UPDATE SET
         seed = EXCLUDED.seed, steps = EXCLUDED.steps, cfg_scale = EXCLUDED.cfg_scale,
         sampler = EXCLUDED.sampler, scheduler = EXCLUDED.scheduler, denoise = EXCLUDED.denoise,
         width = EXCLUDED.width, height = EXCLUDED.height, clip_skip = EXCLUDED.clip_skip`,
      [imageId, gp.seed, gp.steps, gp.cfgScale, gp.sampler, gp.scheduler, gp.denoise, gp.width, gp.height, gp.clipSkip],
    );

    // Tags (prompt source) — replace the prompt-sourced set on re-ingest.
    await clearImageTags(client, imageId, "prompt");
    for (const tag of record.tags) {
      const tagId = await upsertTag(client, tag, null, "prompt");
      await linkImageTag(client, imageId, tagId, { source: "prompt", confidence: 1 });
    }

    // LoRAs.
    await client.query(`DELETE FROM image_loras WHERE image_id = $1 AND source = 'prompt'`, [imageId]);
    for (const lora of record.loras) {
      const loraId = await upsertLora(client, lora.name);
      await linkImageLora(client, imageId, loraId, lora.weight, "prompt");
    }

    return imageId;
  });
}

export async function setThumbnail(imageId: string, thumbnailPath: string): Promise<void> {
  await query(`UPDATE images SET thumbnail_path = $2 WHERE id = $1`, [imageId, thumbnailPath]);
}

export async function setRating(imageId: string, rating: number | null): Promise<void> {
  await query(`UPDATE images SET rating = $2 WHERE id = $1`, [imageId, rating]);
}

export async function setFavorite(imageId: string, favorite: boolean): Promise<void> {
  await query(`UPDATE images SET favorite = $2 WHERE id = $1`, [imageId, favorite]);
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

interface DetailRow {
  id: string;
  file_path: string;
  thumbnail_path: string | null;
  filename: string;
  extension: string | null;
  sha256_hash: string;
  perceptual_hash: string | null;
  width: number | null;
  height: number | null;
  file_size_bytes: string | null;
  created_at: Date | null;
  imported_at: Date;
  modified_at: Date | null;
  source_tool: string | null;
  prompt: string | null;
  negative_prompt: string | null;
  rating: number | null;
  favorite: boolean;
  ingestion_status: string;
  model_name: string | null;
  model_family: string | null;
  checkpoint_name: string | null;
}

export async function getImageDetail(id: string): Promise<ImageDetail | null> {
  const row = await maybeRow<DetailRow>(
    `SELECT i.*, m.name AS model_name, m.family AS model_family, c.name AS checkpoint_name
       FROM images i
       LEFT JOIN models m ON m.id = i.model_id
       LEFT JOIN checkpoints c ON c.id = i.checkpoint_id
      WHERE i.id = $1`,
    [id],
  );
  if (!row) return null;

  const [tagRows, loraRows, gpRow, descRows] = await Promise.all([
    rows<{ name: string; normalized_name: string; category: string | null; confidence: number | null; source: string | null }>(
      `SELECT t.name, t.normalized_name, t.category, it.confidence, it.source
         FROM image_tags it JOIN tags t ON t.id = it.tag_id WHERE it.image_id = $1`,
      [id],
    ),
    rows<{ name: string; weight: number | null }>(
      `SELECT l.name, il.weight FROM image_loras il JOIN loras l ON l.id = il.lora_id WHERE il.image_id = $1`,
      [id],
    ),
    maybeRow<{ seed: string | null; steps: number | null; cfg_scale: number | null; sampler: string | null; scheduler: string | null; denoise: number | null; width: number | null; height: number | null; clip_skip: number | null }>(
      `SELECT * FROM generation_params WHERE image_id = $1`,
      [id],
    ),
    rows<{ id: string; description: string; provider: string | null; model: string | null; created_at: Date }>(
      `SELECT id, description, provider, model, created_at FROM image_descriptions WHERE image_id = $1 ORDER BY created_at DESC`,
      [id],
    ),
  ]);

  return {
    id: row.id,
    filePath: row.file_path,
    thumbnailPath: row.thumbnail_path,
    filename: row.filename,
    extension: row.extension,
    sha256Hash: row.sha256_hash,
    perceptualHash: row.perceptual_hash,
    width: row.width,
    height: row.height,
    fileSizeBytes: row.file_size_bytes ? Number(row.file_size_bytes) : null,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    importedAt: row.imported_at.toISOString(),
    modifiedAt: row.modified_at ? row.modified_at.toISOString() : null,
    sourceTool: row.source_tool,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    rating: row.rating,
    favorite: row.favorite,
    ingestionStatus: row.ingestion_status,
    model: row.model_name,
    checkpoint: row.checkpoint_name,
    modelFamily: row.model_family,
    tags: tagRows.map((t) => ({
      name: t.name,
      normalizedName: t.normalized_name,
      category: t.category,
      confidence: t.confidence,
      source: t.source,
    })),
    loras: loraRows.map((l) => ({ name: l.name, weight: l.weight })),
    generationParams: gpRow
      ? {
          seed: gpRow.seed ? Number(gpRow.seed) : null,
          steps: gpRow.steps,
          cfgScale: gpRow.cfg_scale,
          sampler: gpRow.sampler,
          scheduler: gpRow.scheduler,
          denoise: gpRow.denoise,
          width: gpRow.width,
          height: gpRow.height,
          clipSkip: gpRow.clip_skip,
        }
      : null,
    descriptions: descRows.map((d) => ({
      id: d.id,
      description: d.description,
      provider: d.provider,
      model: d.model,
      createdAt: d.created_at.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Filtered listing (metadata search)
// ---------------------------------------------------------------------------

export interface ImageListItem {
  id: string;
  filename: string;
  thumbnailPath: string | null;
  prompt: string | null;
  rating: number | null;
  favorite: boolean;
  model: string | null;
  checkpoint: string | null;
  tags: string[];
}

/** Build a WHERE clause from search filters; returns sql fragment + params. */
function buildFilterClause(
  filters: SearchFilters & { query?: string; ids?: string[] },
  startIndex: number,
): { where: string; params: unknown[] } {
  const conditions: string[] = ["i.deleted = false"];
  const params: unknown[] = [];
  let idx = startIndex;

  if (filters.ids) {
    conditions.push(`i.id = ANY($${idx})`);
    params.push(filters.ids);
    idx++;
  }
  if (filters.query) {
    conditions.push(`(i.prompt ILIKE $${idx} OR i.filename ILIKE $${idx})`);
    params.push(`%${filters.query}%`);
    idx++;
  }
  if (filters.modelFamily) {
    conditions.push(`m.family = $${idx}`);
    params.push(filters.modelFamily);
    idx++;
  }
  if (filters.checkpoint) {
    conditions.push(`c.name ILIKE $${idx}`);
    params.push(`%${filters.checkpoint}%`);
    idx++;
  }
  if (filters.sourceTool) {
    conditions.push(`i.source_tool = $${idx}`);
    params.push(filters.sourceTool);
    idx++;
  }
  if (typeof filters.ratingGte === "number") {
    conditions.push(`i.rating >= $${idx}`);
    params.push(filters.ratingGte);
    idx++;
  }
  if (filters.favorite) {
    conditions.push(`i.favorite = true`);
  }
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(
      `i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id = it.tag_id
                WHERE t.normalized_name = ANY($${idx}) GROUP BY it.image_id HAVING COUNT(DISTINCT t.normalized_name) = $${idx + 1})`,
    );
    params.push(filters.tags.map((t) => t.toLowerCase().replace(/\s+/g, "_")));
    params.push(filters.tags.length);
    idx += 2;
  }
  if (filters.excludeTags && filters.excludeTags.length > 0) {
    conditions.push(
      `i.id NOT IN (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id = it.tag_id WHERE t.normalized_name = ANY($${idx}))`,
    );
    params.push(filters.excludeTags.map((t) => t.toLowerCase().replace(/\s+/g, "_")));
    idx++;
  }
  if (filters.loras && filters.loras.length > 0) {
    conditions.push(
      `i.id IN (SELECT il.image_id FROM image_loras il JOIN loras l ON l.id = il.lora_id WHERE l.name = ANY($${idx}))`,
    );
    params.push(filters.loras);
    idx++;
  }

  return { where: conditions.join(" AND "), params };
}

export async function listImages(
  filters: SearchFilters & { query?: string; ids?: string[] },
  limit: number,
  offset: number,
): Promise<ImageListItem[]> {
  const { where, params } = buildFilterClause(filters, 1);
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const sql = `
    SELECT i.id, i.filename, i.thumbnail_path, i.prompt, i.rating, i.favorite,
           m.name AS model, c.name AS checkpoint,
           COALESCE(ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
      FROM images i
      LEFT JOIN models m ON m.id = i.model_id
      LEFT JOIN checkpoints c ON c.id = i.checkpoint_id
      LEFT JOIN image_tags it ON it.image_id = i.id
      LEFT JOIN tags t ON t.id = it.tag_id
     WHERE ${where}
     GROUP BY i.id, m.name, c.name
     ORDER BY i.imported_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
  const result = await rows<{
    id: string;
    filename: string;
    thumbnail_path: string | null;
    prompt: string | null;
    rating: number | null;
    favorite: boolean;
    model: string | null;
    checkpoint: string | null;
    tags: string[];
  }>(sql, [...params, limit, offset]);

  return result.map((r) => ({
    id: r.id,
    filename: r.filename,
    thumbnailPath: r.thumbnail_path,
    prompt: r.prompt,
    rating: r.rating,
    favorite: r.favorite,
    model: r.model,
    checkpoint: r.checkpoint,
    tags: r.tags ?? [],
  }));
}

/** Fetch list items for an explicit set of ids, preserving the given order. */
export async function getListItemsByIds(ids: string[]): Promise<Map<string, ImageListItem>> {
  if (ids.length === 0) return new Map();
  const result = await rows<{
    id: string;
    filename: string;
    thumbnail_path: string | null;
    prompt: string | null;
    rating: number | null;
    favorite: boolean;
    model: string | null;
    checkpoint: string | null;
    tags: string[];
  }>(
    `SELECT i.id, i.filename, i.thumbnail_path, i.prompt, i.rating, i.favorite,
            m.name AS model, c.name AS checkpoint,
            COALESCE(ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
       FROM images i
       LEFT JOIN models m ON m.id = i.model_id
       LEFT JOIN checkpoints c ON c.id = i.checkpoint_id
       LEFT JOIN image_tags it ON it.image_id = i.id
       LEFT JOIN tags t ON t.id = it.tag_id
      WHERE i.id = ANY($1)
      GROUP BY i.id, m.name, c.name`,
    [ids],
  );
  const map = new Map<string, ImageListItem>();
  for (const r of result) {
    map.set(r.id, {
      id: r.id,
      filename: r.filename,
      thumbnailPath: r.thumbnail_path,
      prompt: r.prompt,
      rating: r.rating,
      favorite: r.favorite,
      model: r.model,
      checkpoint: r.checkpoint,
      tags: r.tags ?? [],
    });
  }
  return map;
}

/** All image ids + file paths for rebuild/reindex jobs. */
export async function listAllForReindex(): Promise<Array<{ id: string; filePath: string; sha256: string }>> {
  return rows<{ id: string; filePath: string; sha256: string }>(
    `SELECT id, file_path AS "filePath", sha256_hash AS sha256 FROM images WHERE deleted = false`,
  );
}
