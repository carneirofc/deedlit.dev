import {
  getListItemsByIds,
  listImages,
  type ImageListItem,
} from "@/lib/library/repositories/image-repository";
import {
  findSimilarImages as qdrantSimilar,
  searchByImageBuffer as qdrantByImage,
  semanticImageSearch as qdrantSemantic,
  explainSimilarImages as qdrantExplain,
  type SimilarExplain,
  type SimilarityOptions,
} from "@/lib/library/services/qdrant-service";
import { hasExternalImageEmbeddings } from "@/lib/library/services/embedding-service";
import { resolveGraphScope } from "@/lib/library/services/graph-service";
import type { CompactResult, GraphScope, SearchFilters } from "@/lib/library/schemas";

function summarize(item: ImageListItem): string {
  const promptSnippet = item.prompt?.replace(/\s+/g, " ").trim().slice(0, 140);
  if (promptSnippet) return promptSnippet;
  if (item.tags.length) return item.tags.slice(0, 8).join(", ");
  return item.filename;
}

export function toCompactResult(item: ImageListItem, score?: number): CompactResult {
  return {
    imageId: item.id,
    score: score ?? null,
    thumbnailUrl: `/api/library/images/${item.id}/thumbnail`,
    summary: summarize(item),
    tags: item.tags,
    model: item.model,
    checkpoint: item.checkpoint,
    rating: item.rating,
  };
}

/** Pure metadata/relational search against PostgreSQL. */
export async function searchImagesByMetadata(
  filters: SearchFilters & { query?: string; ids?: string[] },
  limit: number,
  offset = 0,
  graphScope?: GraphScope,
): Promise<CompactResult[]> {
  const allowed = await resolveGraphScope(graphScope);
  if (allowed !== null && allowed.length === 0) return [];
  const items = await listImages(
    allowed ? { ...filters, ids: allowed } : filters,
    limit,
    offset,
  );
  return items.map((item) => toCompactResult(item));
}

/** Map scored vector hits back to compact results, preserving score order. */
async function hydrateScored(
  hits: Array<{ id: string; score: number }>,
): Promise<CompactResult[]> {
  const map = await getListItemsByIds(hits.map((h) => h.id));
  const out: CompactResult[] = [];
  for (const hit of hits) {
    const item = map.get(hit.id);
    if (item) out.push(toCompactResult(item, hit.score));
  }
  return out;
}

export async function findSimilarImages(
  imageId: string,
  filters: SearchFilters | undefined,
  limit: number,
  graphScope?: GraphScope,
  minScore = 0,
  options: Omit<SimilarityOptions, "minScore"> = {},
): Promise<CompactResult[]> {
  const allowed = await resolveGraphScope(graphScope);
  if (allowed !== null && allowed.length === 0) return [];
  // minScore is pushed into Qdrant (score_threshold), not filtered here, so the
  // cutoff doesn't silently shrink results below `limit`.
  const hits = await qdrantSimilar(imageId, filters, limit, allowed ?? undefined, { ...options, minScore });
  return hydrateScored(hits);
}

/** Diagnostic trace for similar-image search (provider, vectors, scores, warnings). */
export async function debugSimilarImages(
  imageId: string,
  filters: SearchFilters | undefined,
  limit: number,
  options: SimilarityOptions = {},
): Promise<SimilarExplain> {
  return qdrantExplain(imageId, filters, limit, options);
}

/**
 * Reverse-image search against an external (pasted/uploaded) image.  Works even
 * without a CLIP provider because the local pixel embedding is aligned
 * image-to-image; see {@link generateImageEmbeddingFromBuffer}.
 */
export async function searchByExternalImage(
  buffer: Buffer,
  mime: string,
  filters: SearchFilters | undefined,
  limit: number,
  minScore = 0,
  graphScope?: GraphScope,
): Promise<CompactResult[]> {
  const allowed = await resolveGraphScope(graphScope);
  if (allowed !== null && allowed.length === 0) return [];
  const hits = await qdrantByImage(buffer, mime, filters, limit, allowed ?? undefined, { minScore });
  return hydrateScored(hits);
}

/**
 * Semantic search.  When a real image/text embedding provider is configured the
 * text query is embedded into the same space as images and matched in Qdrant.
 * Without one, the local text vector is not aligned with image vectors, so we
 * fall back to PostgreSQL metadata search to keep results meaningful.
 */
export async function semanticImageSearch(
  query: string,
  filters: SearchFilters | undefined,
  limit: number,
  minScore = 0,
): Promise<CompactResult[]> {
  if (hasExternalImageEmbeddings()) {
    const hits = await qdrantSemantic(query, filters, limit, undefined, { minScore });
    if (hits.length > 0) return hydrateScored(hits);
  }
  return searchImagesByMetadata({ ...(filters ?? {}), query }, limit);
}

/**
 * Hybrid search: union of metadata candidates and (when available) semantic
 * vector candidates, de-duplicated with vector score preferred.
 */
export async function hybridSearch(
  query: string,
  filters: SearchFilters | undefined,
  limit: number,
  graphScope?: GraphScope,
): Promise<CompactResult[]> {
  const allowed = await resolveGraphScope(graphScope);
  if (allowed !== null && allowed.length === 0) return [];
  const [metadata, semantic] = await Promise.all([
    searchImagesByMetadata({ ...(filters ?? {}), query, ids: allowed ?? undefined }, limit),
    hasExternalImageEmbeddings()
      ? qdrantSemantic(query, filters, limit, allowed ?? undefined).then(hydrateScored)
      : Promise.resolve([]),
  ]);

  const byId = new Map<string, CompactResult>();
  for (const r of semantic) byId.set(r.imageId, r);
  for (const r of metadata) if (!byId.has(r.imageId)) byId.set(r.imageId, r);

  return Array.from(byId.values())
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

// --- result grouping helpers (Phase 9) ------------------------------------

export function groupResultsByModel(results: CompactResult[]): Record<string, CompactResult[]> {
  const groups: Record<string, CompactResult[]> = {};
  for (const r of results) {
    const key = r.model ?? "unknown";
    (groups[key] ??= []).push(r);
  }
  return groups;
}

export function groupResultsByTag(results: CompactResult[]): Record<string, CompactResult[]> {
  const groups: Record<string, CompactResult[]> = {};
  for (const r of results) {
    for (const tag of r.tags) (groups[tag] ??= []).push(r);
  }
  return groups;
}
