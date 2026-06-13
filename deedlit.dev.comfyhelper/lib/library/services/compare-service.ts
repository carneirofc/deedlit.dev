import path from "node:path";

import { getLogger } from "@/lib/logger";
import { getImageDetail } from "@/lib/library/repositories/image-repository";
import { retrieveVectors } from "@/lib/library/repositories/vector-repository";
import { getCombinedImageGraph } from "@/lib/library/services/graph-service";
import type {
  CompareField,
  CompareImage,
  CompareResult,
  ImageDetail,
  PairwiseSimilarity,
} from "@/lib/library/schemas";

const logger = getLogger({ scope: "library-compare-service" });

/** Cosine similarity (vectors are usually L2-normalized, but be defensive). */
function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

function toCompareImage(detail: ImageDetail): CompareImage {
  const tags = Array.from(new Set(detail.tags.map((t) => t.name)));
  return {
    id: detail.id,
    filename: detail.filename,
    thumbnailUrl: `/api/library/images/${detail.id}/thumbnail`,
    imageUrl: `/api/library/images/${detail.id}/file`,
    prompt: detail.prompt,
    negativePrompt: detail.negativePrompt,
    model: detail.model,
    checkpoint: detail.checkpoint,
    modelFamily: detail.modelFamily,
    width: detail.width,
    height: detail.height,
    rating: detail.rating,
    favorite: detail.favorite,
    sourceTool: detail.sourceTool,
    folder: detail.filePath ? path.dirname(detail.filePath) : null,
    tags,
    loras: detail.loras,
    generationParams: detail.generationParams,
  };
}

const num = (v: number | null | undefined): string | null => (v != null ? String(v) : null);

/** Field rows of the comparison diff table (one column per image). */
const FIELD_DEFS: Array<{ key: string; label: string; get: (img: CompareImage) => string | null }> = [
  { key: "model", label: "Model", get: (i) => i.model },
  { key: "checkpoint", label: "Checkpoint", get: (i) => i.checkpoint },
  { key: "modelFamily", label: "Family", get: (i) => i.modelFamily },
  { key: "sourceTool", label: "Source", get: (i) => i.sourceTool },
  { key: "size", label: "Size", get: (i) => (i.width && i.height ? `${i.width}×${i.height}` : null) },
  { key: "seed", label: "Seed", get: (i) => num(i.generationParams?.seed) },
  { key: "steps", label: "Steps", get: (i) => num(i.generationParams?.steps) },
  { key: "cfgScale", label: "CFG", get: (i) => num(i.generationParams?.cfgScale) },
  { key: "sampler", label: "Sampler", get: (i) => i.generationParams?.sampler ?? null },
  { key: "scheduler", label: "Scheduler", get: (i) => i.generationParams?.scheduler ?? null },
  { key: "denoise", label: "Denoise", get: (i) => num(i.generationParams?.denoise) },
  { key: "clipSkip", label: "Clip skip", get: (i) => num(i.generationParams?.clipSkip) },
  {
    key: "loras",
    label: "LoRAs",
    get: (i) =>
      i.loras.length
        ? i.loras.map((l) => (l.weight != null ? `${l.name} (${l.weight})` : l.name)).join(", ")
        : null,
  },
  { key: "rating", label: "Rating", get: (i) => num(i.rating) },
];

/**
 * Compare 2–4 images: per-field diff table, shared/unique tags, pairwise
 * embedding similarity, and the combined Neo4j relationship subgraph.  Postgres
 * is canonical for the diff; Qdrant/Neo4j are best-effort (compare still works
 * when they are down).
 */
export async function compareImages(imageIds: string[]): Promise<CompareResult> {
  const details = (await Promise.all(imageIds.map((id) => getImageDetail(id)))).filter(
    (d): d is ImageDetail => d !== null,
  );
  const images = details.map(toCompareImage);

  const fields: CompareField[] = FIELD_DEFS.map((def) => {
    const values = images.map((img) => def.get(img));
    const allEqual = values.every((v) => v === values[0]);
    return { key: def.key, label: def.label, values, allEqual };
  });

  // Tag set operations across all images.
  const tagSets = images.map((i) => new Set(i.tags));
  const sharedTags = images.length
    ? images[0].tags.filter((t) => tagSets.every((s) => s.has(t)))
    : [];
  const uniqueTags = images.map((img, idx) =>
    img.tags.filter((t) => !tagSets.some((s, j) => j !== idx && s.has(t))),
  );

  // Pairwise embedding similarity (best-effort).
  const pairwiseSimilarity: PairwiseSimilarity[] = [];
  try {
    const vectors = await retrieveVectors(images.map((i) => i.id));
    for (let i = 0; i < images.length; i++) {
      for (let j = i + 1; j < images.length; j++) {
        const va = vectors.get(images[i].id);
        const vb = vectors.get(images[j].id);
        if (va && vb) {
          pairwiseSimilarity.push({ a: images[i].id, b: images[j].id, score: cosine(va, vb) });
        }
      }
    }
  } catch (error) {
    logger.warn({ err: error }, "compareImages: pairwise similarity unavailable");
  }

  // Combined relationship subgraph (best-effort).
  let graph = { nodes: [], edges: [] } as CompareResult["graph"];
  try {
    graph = await getCombinedImageGraph(images.map((i) => i.id), 1);
  } catch (error) {
    logger.warn({ err: error }, "compareImages: combined graph unavailable");
  }

  return {
    images,
    fields,
    sharedTags,
    uniqueTags,
    pairwiseSimilarity,
    similarityAvailable: pairwiseSimilarity.length > 0,
    graph,
  };
}
