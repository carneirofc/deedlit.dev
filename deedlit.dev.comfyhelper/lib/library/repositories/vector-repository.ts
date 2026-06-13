import { getLibraryConfig } from "@/lib/library/config";
import { getQdrant } from "@/lib/library/db/qdrant";

declare global {
  var __comfyhelperQdrantReady: boolean | undefined;
}

export interface ImageVectorPayload {
  image_id: string;
  file_path: string;
  thumbnail_path: string | null;
  /**
   * Browser-reachable proxy URLs (absolute) served by comfyhelper.  Stored so
   * the Qdrant dashboard / deedlit.vision test UI can render the image instead
   * of choking on `file_path`, which is a server-local filesystem path.
   */
  thumbnail_url: string;
  image_url: string;
  tags: string[];
  model_family: string | null;
  checkpoint: string | null;
  loras: string[];
  rating: number | null;
  width: number | null;
  height: number | null;
  created_at: string | null;
  source_tool: string | null;
  favorite: boolean;
}

export async function ensureCollection(): Promise<void> {
  if (globalThis.__comfyhelperQdrantReady) return;
  const { qdrantCollection, embeddingDimensions } = getLibraryConfig();
  const client = getQdrant();
  const existing = await client.getCollections();
  const found = existing.collections.some((c) => c.name === qdrantCollection);
  if (!found) {
    await client.createCollection(qdrantCollection, {
      vectors: { size: embeddingDimensions, distance: "Cosine" },
    });
    // Payload indexes for fast filtered retrieval.
    for (const field of ["tags", "model_family", "checkpoint", "loras", "favorite"]) {
      await client.createPayloadIndex(qdrantCollection, { field_name: field, field_schema: "keyword" }).catch(() => {});
    }
    await client.createPayloadIndex(qdrantCollection, { field_name: "rating", field_schema: "integer" }).catch(() => {});
  }
  globalThis.__comfyhelperQdrantReady = true;
}

export async function upsertPoint(
  id: string,
  vector: number[],
  payload: ImageVectorPayload,
): Promise<void> {
  const { qdrantCollection } = getLibraryConfig();
  await getQdrant().upsert(qdrantCollection, {
    wait: true,
    points: [{ id, vector, payload: payload as unknown as Record<string, unknown> }],
  });
}

export async function deletePoint(id: string): Promise<void> {
  const { qdrantCollection } = getLibraryConfig();
  await getQdrant().delete(qdrantCollection, { wait: true, points: [id] });
}

export async function retrieveVector(id: string): Promise<number[] | null> {
  const { qdrantCollection } = getLibraryConfig();
  const result = await getQdrant().retrieve(qdrantCollection, { ids: [id], with_vector: true });
  const point = result[0];
  if (!point || !point.vector) return null;
  return Array.isArray(point.vector) ? (point.vector as number[]) : null;
}

/** Batch-retrieve raw vectors for several points (used for pairwise compare). */
export async function retrieveVectors(ids: string[]): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  if (ids.length === 0) return map;
  const { qdrantCollection } = getLibraryConfig();
  const result = await getQdrant().retrieve(qdrantCollection, { ids, with_vector: true });
  for (const point of result) {
    if (Array.isArray(point.vector)) map.set(String(point.id), point.vector as number[]);
  }
  return map;
}

export interface SimilarityMatrix {
  /** Point ids in the order the matrix offsets reference. */
  ids: string[];
  /** Sparse similarity edges (higher score = more similar, Cosine). */
  pairs: Array<{ a: string; b: string; score: number }>;
}

/**
 * Qdrant Distance Matrix API — samples `sample` points from the (optionally
 * filtered) collection and returns each point's `neighbors` nearest peers as a
 * sparse similarity matrix.  Purpose-built for clustering: we decode the
 * parallel offset/score arrays into id-pair edges.
 */
export async function searchSimilarityMatrix(
  filter: QdrantFilter | undefined,
  sample: number,
  neighbors: number,
): Promise<SimilarityMatrix> {
  const { qdrantCollection } = getLibraryConfig();
  const res = await getQdrant().searchMatrixOffsets(qdrantCollection, {
    filter: filter as Record<string, unknown> | undefined,
    sample,
    limit: neighbors,
  });
  const ids = (res.ids ?? []).map((id) => String(id));
  const rows = res.offsets_row ?? [];
  const cols = res.offsets_col ?? [];
  const scores = res.scores ?? [];
  const pairs: Array<{ a: string; b: string; score: number }> = [];
  for (let k = 0; k < rows.length; k++) {
    const a = ids[rows[k]];
    const b = ids[cols[k]];
    if (a && b && a !== b) pairs.push({ a, b, score: scores[k] });
  }
  return { ids, pairs };
}

export interface QdrantFilter {
  must?: unknown[];
  must_not?: unknown[];
}

/** Default HNSW `ef` for search — higher = better recall, slower. */
export const DEFAULT_HNSW_EF = 128;

export interface VectorSearchOptions {
  /**
   * Cosine cutoff pushed into Qdrant as `score_threshold`. Unlike filtering in
   * JS after the fact, this lets Qdrant keep scanning so it can still return up
   * to `limit` results that clear the bar. 0 / undefined disables it.
   */
  scoreThreshold?: number;
  /** HNSW search beam width. Raise for recall on larger collections. */
  hnswEf?: number;
  /** Bypass the HNSW index for an exact (slow) brute-force scan — debug/ground-truth. */
  exact?: boolean;
  /** Return the stored payload alongside each hit (debug). */
  withPayload?: boolean;
}

export interface ScoredHit {
  id: string;
  score: number;
  payload?: Record<string, unknown> | null;
}

export async function searchByVector(
  vector: number[],
  filter: QdrantFilter | undefined,
  limit: number,
  options: VectorSearchOptions = {},
): Promise<Array<{ id: string; score: number }>> {
  const hits = await searchByVectorDetailed(vector, filter, limit, options);
  return hits.map((h) => ({ id: h.id, score: h.score }));
}

/** Like {@link searchByVector} but can carry the payload (debug surface). */
export async function searchByVectorDetailed(
  vector: number[],
  filter: QdrantFilter | undefined,
  limit: number,
  options: VectorSearchOptions = {},
): Promise<ScoredHit[]> {
  const { qdrantCollection } = getLibraryConfig();
  const { scoreThreshold, hnswEf = DEFAULT_HNSW_EF, exact = false, withPayload = false } = options;
  const result = await getQdrant().search(qdrantCollection, {
    vector,
    limit,
    filter: filter as Record<string, unknown> | undefined,
    score_threshold: scoreThreshold && scoreThreshold > 0 ? scoreThreshold : undefined,
    params: { hnsw_ef: hnswEf, exact },
    with_payload: withPayload,
  });
  return result.map((r) => ({
    id: String(r.id),
    score: r.score,
    payload: withPayload ? ((r.payload as Record<string, unknown> | null) ?? null) : undefined,
  }));
}

export interface CollectionInfo {
  exists: boolean;
  vectorSize: number | null;
  distance: string | null;
  pointsCount: number | null;
}

/** Inspect the live Qdrant collection (dim / metric / size) for diagnostics. */
export async function getCollectionInfo(): Promise<CollectionInfo> {
  const { qdrantCollection } = getLibraryConfig();
  try {
    const info = await getQdrant().getCollection(qdrantCollection);
    const vectors = info.config?.params?.vectors as
      | { size?: number; distance?: string }
      | Record<string, { size?: number; distance?: string }>
      | undefined;
    let size: number | null = null;
    let distance: string | null = null;
    if (vectors && typeof vectors === "object") {
      if ("size" in vectors && typeof vectors.size === "number") {
        size = vectors.size;
        distance = (vectors.distance as string) ?? null;
      } else {
        const first = Object.values(vectors)[0] as { size?: number; distance?: string } | undefined;
        if (first) {
          size = first.size ?? null;
          distance = first.distance ?? null;
        }
      }
    }
    return { exists: true, vectorSize: size, distance, pointsCount: info.points_count ?? null };
  } catch {
    return { exists: false, vectorSize: null, distance: null, pointsCount: null };
  }
}

export async function recreateCollection(): Promise<void> {
  const { qdrantCollection } = getLibraryConfig();
  await getQdrant().deleteCollection(qdrantCollection).catch(() => {});
  globalThis.__comfyhelperQdrantReady = false;
  await ensureCollection();
}
