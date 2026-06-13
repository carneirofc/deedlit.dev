import type { PoolClient } from "pg";

import { rows } from "@/lib/library/db/postgres";
import { normalizeTag } from "@/lib/prompt-tags";

/** Canonical tag normalization for the library: lowercase, spaces -> underscore. */
export function canonicalTagName(raw: string): string {
  return normalizeTag(raw).replace(/\s+/g, "_").replace(/_+/g, "_");
}

export async function upsertTag(
  client: PoolClient,
  rawName: string,
  category: string | null = null,
  source: string | null = null,
): Promise<string> {
  const name = rawName.trim();
  const normalized = canonicalTagName(rawName);
  const result = await client.query<{ id: string }>(
    `INSERT INTO tags (name, normalized_name, category, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (normalized_name)
       DO UPDATE SET category = COALESCE(tags.category, EXCLUDED.category)
     RETURNING id`,
    [name, normalized, category, source],
  );
  return result.rows[0].id;
}

export async function linkImageTag(
  client: PoolClient,
  imageId: string,
  tagId: string,
  options: { confidence?: number | null; source?: string } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO image_tags (image_id, tag_id, confidence, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (image_id, tag_id, source)
       DO UPDATE SET confidence = EXCLUDED.confidence`,
    [imageId, tagId, options.confidence ?? null, options.source ?? "prompt"],
  );
}

/** Remove every tag attached to an image (used when re-extracting metadata). */
export async function clearImageTags(client: PoolClient, imageId: string, source?: string): Promise<void> {
  if (source) {
    await client.query(`DELETE FROM image_tags WHERE image_id = $1 AND source = $2`, [imageId, source]);
  } else {
    await client.query(`DELETE FROM image_tags WHERE image_id = $1`, [imageId]);
  }
}

/** Tags that co-occur most often with the given tag across the library. */
export async function findRelatedTags(
  tag: string,
  limit: number,
): Promise<Array<{ name: string; coOccurrence: number }>> {
  const normalized = canonicalTagName(tag);
  return rows<{ name: string; coOccurrence: number }>(
    `WITH target AS (
       SELECT id FROM tags WHERE normalized_name = $1
     ),
     target_images AS (
       SELECT it.image_id FROM image_tags it JOIN target ON it.tag_id = target.id
     )
     SELECT t.name AS name, COUNT(*)::int AS "coOccurrence"
       FROM image_tags it
       JOIN target_images ti ON it.image_id = ti.image_id
       JOIN tags t ON t.id = it.tag_id
      WHERE t.normalized_name <> $1
      GROUP BY t.name
      ORDER BY "coOccurrence" DESC
      LIMIT $2`,
    [normalized, limit],
  );
}
