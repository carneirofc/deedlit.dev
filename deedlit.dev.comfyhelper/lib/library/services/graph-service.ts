import path from "node:path";

import { getImageDetail, listAllForReindex } from "@/lib/library/repositories/image-repository";
import {
  clearGraph,
  getCombinedSubgraph,
  getConnectedImageIds,
  getImageSubgraph,
  upsertImageNode,
} from "@/lib/library/repositories/graph-repository";
import { findRelatedTags as findRelatedTagsSql } from "@/lib/library/repositories/tag-repository";
import { rows } from "@/lib/library/db/postgres";
import type { Graph, GraphScope } from "@/lib/library/schemas";

/** Project a single image (and its relationships) into Neo4j. */
export async function syncImageToGraph(imageId: string): Promise<void> {
  const detail = await getImageDetail(imageId);
  if (!detail) return;
  await upsertImageNode({
    imageId: detail.id,
    filename: detail.filename,
    thumbnailPath: detail.thumbnailPath,
    rating: detail.rating,
    tags: detail.tags.map((t) => t.normalizedName),
    loras: detail.loras.map((l) => l.name),
    model: detail.model,
    checkpoint: detail.checkpoint,
    modelFamily: detail.modelFamily,
    folder: path.dirname(detail.filePath),
  });
}

/** Wipe and rebuild the whole Neo4j projection from PostgreSQL. */
export async function rebuildGraph(): Promise<{ synced: number }> {
  await clearGraph();
  const all = await listAllForReindex();
  let synced = 0;
  for (const img of all) {
    await syncImageToGraph(img.id);
    synced++;
  }
  return { synced };
}

export async function getImageGraph(
  imageId: string,
  depth: number,
  relationshipTypes: string[] | undefined,
): Promise<Graph> {
  return getImageSubgraph(imageId, depth, relationshipTypes);
}

/**
 * Resolve a graph-relationship constraint to the image ids it allows.  Returns
 * `null` when there is no scope (no constraint), or `string[]` (possibly empty)
 * when a scope is present — an empty array means "scope matched nothing".
 */
export async function resolveGraphScope(
  graphScope: GraphScope | undefined,
  limit = 5000,
): Promise<string[] | null> {
  if (!graphScope) return null;
  return getConnectedImageIds(graphScope, limit);
}

/** Union of several images' subgraphs (shared hubs flagged) for comparison. */
export async function getCombinedImageGraph(imageIds: string[], depth: number): Promise<Graph> {
  return getCombinedSubgraph(imageIds, depth);
}

export async function findRelatedTags(tag: string, limit: number) {
  return findRelatedTagsSql(tag, limit);
}

/** LoRAs frequently used together with the given LoRA. */
export async function findRelatedLoras(lora: string, limit: number) {
  return rows<{ name: string; coOccurrence: number }>(
    `WITH target AS (SELECT id FROM loras WHERE name = $1),
     target_images AS (SELECT il.image_id FROM image_loras il JOIN target ON il.lora_id = target.id)
     SELECT l.name AS name, COUNT(*)::int AS "coOccurrence"
       FROM image_loras il
       JOIN target_images ti ON il.image_id = ti.image_id
       JOIN loras l ON l.id = il.lora_id
      WHERE l.name <> $1
      GROUP BY l.name ORDER BY "coOccurrence" DESC LIMIT $2`,
    [lora, limit],
  );
}

/** Original/variant/upscale/inpaint relationships from PostgreSQL. */
export async function findImageLineage(imageId: string) {
  const [ancestors, descendants] = await Promise.all([
    rows<{ id: string; filename: string; relation: string }>(
      `SELECT i.id, i.filename, v.relation_type AS relation
         FROM image_variants v JOIN images i ON i.id = v.source_image_id
        WHERE v.derived_image_id = $1`,
      [imageId],
    ),
    rows<{ id: string; filename: string; relation: string }>(
      `SELECT i.id, i.filename, v.relation_type AS relation
         FROM image_variants v JOIN images i ON i.id = v.derived_image_id
        WHERE v.source_image_id = $1`,
      [imageId],
    ),
  ]);
  return { imageId, ancestors, descendants };
}
