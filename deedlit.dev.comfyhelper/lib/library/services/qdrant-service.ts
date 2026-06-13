import { getLogger } from "@/lib/logger";
import { getLibraryConfig } from "@/lib/library/config";
import { getImageDetail } from "@/lib/library/repositories/image-repository";
import {
  ensureCollection,
  getCollectionInfo,
  recreateCollection,
  retrieveVector,
  searchByVector,
  searchByVectorDetailed,
  upsertPoint,
  deletePoint,
  DEFAULT_HNSW_EF,
  type CollectionInfo,
  type ImageVectorPayload,
  type QdrantFilter,
  type ScoredHit,
} from "@/lib/library/repositories/vector-repository";
import {
  getEmbeddingDiagnostics,
  getOrComputeImageEmbedding,
  generateImageEmbeddingFromBuffer,
  generateTextEmbedding,
  isZeroVector,
  vectorStats,
  type EmbeddingDiagnostics,
  type VectorStats,
} from "@/lib/library/services/embedding-service";
import type { SearchFilters } from "@/lib/library/schemas";

const logger = getLogger({ scope: "library-qdrant-service" });

export async function ensureImagesCollection(): Promise<void> {
  await ensureCollection();
}

/**
 * Translate domain search filters (and an optional Neo4j-resolved id allow-list)
 * into a Qdrant payload filter.  `allowedIds` becomes a `has_id` condition so
 * graph-scoped similarity only matches images the graph permits.
 */
export function buildQdrantFilter(
  filters: SearchFilters | undefined,
  allowedIds?: string[],
): QdrantFilter | undefined {
  const must: unknown[] = [];
  const mustNot: unknown[] = [];

  if (filters) {
    if (filters.modelFamily) must.push({ key: "model_family", match: { value: filters.modelFamily } });
    if (filters.checkpoint) must.push({ key: "checkpoint", match: { value: filters.checkpoint } });
    if (filters.sourceTool) must.push({ key: "source_tool", match: { value: filters.sourceTool } });
    if (filters.favorite) must.push({ key: "favorite", match: { value: true } });
    if (typeof filters.ratingGte === "number") must.push({ key: "rating", range: { gte: filters.ratingGte } });
    if (filters.tags) for (const t of filters.tags) must.push({ key: "tags", match: { value: t } });
    if (filters.loras) for (const l of filters.loras) must.push({ key: "loras", match: { value: l } });
    if (filters.excludeTags) for (const t of filters.excludeTags) mustNot.push({ key: "tags", match: { value: t } });
  }
  if (allowedIds && allowedIds.length > 0) must.push({ has_id: allowedIds });

  if (must.length === 0 && mustNot.length === 0) return undefined;
  const filter: QdrantFilter = {};
  if (must.length) filter.must = must;
  if (mustNot.length) filter.must_not = mustNot;
  return filter;
}

/**
 * Compute the embedding for an image and upsert it with its payload.
 * Returns false (and does NOT upsert) when the embedding fails or is a zero
 * vector, so a broken image can never poison the collection.
 */
export async function upsertImageVector(imageId: string): Promise<boolean> {
  const detail = await getImageDetail(imageId);
  if (!detail) {
    logger.warn({ imageId }, "upsertImageVector: image not found");
    return false;
  }
  await ensureCollection();
  let vector: number[];
  try {
    vector = await getOrComputeImageEmbedding(detail.filePath, detail.sha256Hash);
  } catch (error) {
    logger.warn({ err: error, imageId }, "upsertImageVector: embedding failed, skipping");
    return false;
  }
  if (isZeroVector(vector)) {
    logger.warn({ imageId }, "upsertImageVector: zero embedding, skipping (would poison search)");
    return false;
  }
  const base = getLibraryConfig().publicBaseUrl;
  // Extension makes the Qdrant dashboard render these URLs as image previews.
  // `detail.extension` already carries the leading dot (or null). Thumbnails are
  // always WebP regardless of the original's format.
  const ext = detail.extension ?? "";
  const payload: ImageVectorPayload = {
    image_id: detail.id,
    file_path: detail.filePath,
    thumbnail_path: detail.thumbnailPath,
    thumbnail_url: `${base}/api/library/images/${detail.id}/thumbnail.webp`,
    image_url: `${base}/api/library/images/${detail.id}/file${ext}`,
    tags: detail.tags.map((t) => t.normalizedName),
    model_family: detail.modelFamily,
    checkpoint: detail.checkpoint,
    loras: detail.loras.map((l) => l.name),
    rating: detail.rating,
    width: detail.width,
    height: detail.height,
    created_at: detail.createdAt,
    source_tool: detail.sourceTool,
    favorite: detail.favorite,
  };
  await upsertPoint(detail.id, vector, payload);
  return true;
}

export async function deleteImageVector(imageId: string): Promise<void> {
  await deletePoint(imageId).catch(() => {});
}

/** Tunables shared by the vector searches; `minScore` maps to Qdrant's score_threshold. */
export interface SimilarityOptions {
  minScore?: number;
  hnswEf?: number;
  exact?: boolean;
}

export async function findSimilarImages(
  imageId: string,
  filters: SearchFilters | undefined,
  limit: number,
  allowedIds?: string[],
  options: SimilarityOptions = {},
): Promise<Array<{ id: string; score: number }>> {
  await ensureCollection();
  const vector = await retrieveVector(imageId);
  if (!vector) return [];
  // limit + 1 so we can drop the query image itself and still return `limit`.
  const results = await searchByVector(vector, buildQdrantFilter(filters, allowedIds), limit + 1, {
    scoreThreshold: options.minScore,
    hnswEf: options.hnswEf,
    exact: options.exact,
  });
  return results.filter((r) => r.id !== imageId).slice(0, limit);
}

export async function semanticImageSearch(
  query: string,
  filters: SearchFilters | undefined,
  limit: number,
  allowedIds?: string[],
  options: SimilarityOptions = {},
): Promise<Array<{ id: string; score: number }>> {
  await ensureCollection();
  const vector = await generateTextEmbedding(query);
  return searchByVector(vector, buildQdrantFilter(filters, allowedIds), limit, {
    scoreThreshold: options.minScore,
    hnswEf: options.hnswEf,
    exact: options.exact,
  });
}

/**
 * Reverse-image search: embed an external (pasted/uploaded) image and match it
 * against the indexed collection.  The image is never persisted.
 */
export async function searchByImageBuffer(
  buffer: Buffer,
  mime: string,
  filters: SearchFilters | undefined,
  limit: number,
  allowedIds?: string[],
  options: SimilarityOptions = {},
): Promise<Array<{ id: string; score: number }>> {
  await ensureCollection();
  const vector = await generateImageEmbeddingFromBuffer(buffer, mime);
  return searchByVector(vector, buildQdrantFilter(filters, allowedIds), limit, {
    scoreThreshold: options.minScore,
    hnswEf: options.hnswEf,
    exact: options.exact,
  });
}

export async function findNearDuplicates(
  imageId: string,
  threshold: number,
  limit: number,
): Promise<Array<{ id: string; score: number }>> {
  // Push the threshold into Qdrant instead of filtering after truncation, so a
  // strict cutoff still returns up to `limit` genuine duplicates.
  return findSimilarImages(imageId, undefined, limit, undefined, { minScore: threshold });
}

// --- diagnostics -----------------------------------------------------------

export interface SimilarExplain {
  query: {
    imageId: string;
    vectorFound: boolean;
    stats: VectorStats | null;
  };
  collection: CollectionInfo;
  embedding: EmbeddingDiagnostics;
  params: { limit: number; minScore: number; hnswEf: number; exact: boolean };
  hits: Array<{ id: string; score: number; isSelf: boolean; payload: Record<string, unknown> | null }>;
  warnings: string[];
  tookMs: number;
}

/**
 * Full diagnostic trace for "why did similar-search return this?". Reports the
 * stored query vector's health, the live collection geometry, the active
 * embedder, and every hit with its score + payload — so a bad ranking can be
 * traced to local-fallback embeddings, a dim mismatch, or a poisoned vector.
 */
export async function explainSimilarImages(
  imageId: string,
  filters: SearchFilters | undefined,
  limit: number,
  options: SimilarityOptions = {},
): Promise<SimilarExplain> {
  const started = Date.now();
  await ensureCollection();
  const minScore = options.minScore ?? 0;
  const hnswEf = options.hnswEf ?? DEFAULT_HNSW_EF;
  const exact = options.exact ?? false;

  const [vector, collection, embedding] = await Promise.all([
    retrieveVector(imageId),
    getCollectionInfo(),
    Promise.resolve(getEmbeddingDiagnostics()),
  ]);

  const warnings: string[] = [];
  if (!embedding.hasExternalImageEmbeddings) {
    warnings.push(
      "CLIP_VISION_API_URL is not set — deedlit.vision is required for embeddings (no local fallback). Similarity search will error until it is configured.",
    );
  }
  if (collection.exists && collection.vectorSize !== null && collection.vectorSize !== embedding.dimensions) {
    warnings.push(
      `Collection is ${collection.vectorSize}-dim but the embedder produces ${embedding.dimensions}-dim — rebuild Qdrant (/api/library/maintenance/rebuild-qdrant).`,
    );
  }
  if (collection.distance && collection.distance.toLowerCase() !== "cosine") {
    warnings.push(`Collection distance is ${collection.distance}; embeddings are L2-normalized for Cosine.`);
  }

  let hits: ScoredHit[] = [];
  let stats: VectorStats | null = null;
  if (vector) {
    stats = vectorStats(vector);
    if (stats.isZero) warnings.push("Stored query vector is all zeros — this image was indexed from a failed embedding; reindex it.");
    const detailed = await searchByVectorDetailed(vector, buildQdrantFilter(filters), limit + 1, {
      scoreThreshold: minScore,
      hnswEf,
      exact,
      withPayload: true,
    });
    hits = detailed.filter((h) => h.id !== imageId).slice(0, limit);
  } else {
    warnings.push("No stored vector for this image — it is not indexed in Qdrant. Reindex it.");
  }

  return {
    query: { imageId, vectorFound: vector !== null, stats },
    collection,
    embedding,
    params: { limit, minScore, hnswEf, exact },
    hits: hits.map((h) => ({ id: h.id, score: h.score, isSelf: h.id === imageId, payload: h.payload ?? null })),
    warnings,
    tookMs: Date.now() - started,
  };
}

export async function rebuildQdrant(
  allImages: Array<{ id: string }>,
): Promise<{ indexed: number; skipped: number; failed: number }> {
  await recreateCollection();
  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  for (const img of allImages) {
    try {
      if (await upsertImageVector(img.id)) indexed++;
      else skipped++;
    } catch (error) {
      logger.warn({ err: error, imageId: img.id }, "rebuildQdrant: failed to index image");
      failed++;
    }
  }
  return { indexed, skipped, failed };
}
