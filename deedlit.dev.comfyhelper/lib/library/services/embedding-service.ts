import { readFile } from "node:fs/promises";
import path from "node:path";

import { getLogger } from "@/lib/logger";
import { getLibraryConfig } from "@/lib/library/config";
import { getObjectBuffer, isObjectStoreEnabled, putObject } from "@/lib/library/storage/object-store";

const logger = getLogger({ scope: "library-embedding" });

export function getEmbeddingProvider(): string {
  // deedlit.vision is the only embedding provider — there is no local fallback.
  return getLibraryConfig().clipVisionApiUrl ? "deedlit-vision" : "unconfigured";
}

/**
 * Whether the (mandatory) learned image-embedding provider is configured.
 * With the local pixel-histogram fallback removed, this is simply "is
 * deedlit.vision configured" — when false, embeddings throw rather than degrade.
 */
export function hasExternalImageEmbeddings(): boolean {
  return Boolean(getLibraryConfig().clipVisionApiUrl);
}

/** A vector with effectively no magnitude — a failed/garbage embedding. */
export function isZeroVector(vec: number[]): boolean {
  for (const v of vec) if (v !== 0 && Number.isFinite(v)) return false;
  return true;
}

export interface VectorStats {
  dims: number;
  /** L2 magnitude before normalization (≈1 for a healthy stored vector). */
  norm: number;
  isZero: boolean;
  nonZero: number;
  min: number;
  max: number;
  /** First few components, for eyeballing. */
  sample: number[];
}

/** Cheap diagnostics for a single embedding vector (debug surface). */
export function vectorStats(vec: number[]): VectorStats {
  let norm = 0;
  let nonZero = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of vec) {
    norm += v * v;
    if (v !== 0) nonZero++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    dims: vec.length,
    norm: Math.sqrt(norm),
    isZero: isZeroVector(vec),
    nonZero,
    min: vec.length ? min : 0,
    max: vec.length ? max : 0,
    sample: vec.slice(0, 8),
  };
}

export interface EmbeddingDiagnostics {
  provider: string;
  dimensions: number;
  /** True only when a learned image embedder (CLIP) is configured. */
  hasExternalImageEmbeddings: boolean;
  clipVisionApiUrl: string | null;
}

export function getEmbeddingDiagnostics(): EmbeddingDiagnostics {
  const { clipVisionApiUrl, embeddingDimensions } = getLibraryConfig();
  return {
    provider: getEmbeddingProvider(),
    dimensions: embeddingDimensions,
    hasExternalImageEmbeddings: hasExternalImageEmbeddings(),
    clipVisionApiUrl: clipVisionApiUrl || null,
  };
}

export interface VisionApiHealth {
  /** Whether CLIP_VISION_API_URL is set at all. */
  configured: boolean;
  url: string | null;
  /** Whether the vision /health endpoint actually answered. */
  reachable: boolean;
  modelPreset?: string;
  /** Embedding dim the vision model produces (must equal EMBEDDING_DIMENSIONS). */
  expectedDim?: number;
  device?: string;
  detail?: string;
}

/**
 * Actively probe the deedlit.vision CLIP API. Unlike {@link hasExternalImageEmbeddings}
 * (config-only), this verifies the service is up — so "CLIP configured but the
 * container isn't running" is distinguishable from "CLIP not configured".
 */
export async function pingVisionApi(): Promise<VisionApiHealth> {
  const { clipVisionApiUrl } = getLibraryConfig();
  if (!clipVisionApiUrl) {
    return {
      configured: false,
      url: null,
      reachable: false,
      detail: "CLIP_VISION_API_URL not set — deedlit.vision is required (no local fallback).",
    };
  }
  try {
    const res = await fetch(`${clipVisionApiUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { configured: true, url: clipVisionApiUrl, reachable: false, detail: `vision /health HTTP ${res.status}` };
    }
    const json = (await res.json()) as { model_preset?: string; expected_dim?: number; device?: string };
    return {
      configured: true,
      url: clipVisionApiUrl,
      reachable: true,
      modelPreset: json.model_preset,
      expectedDim: json.expected_dim,
      device: json.device,
    };
  } catch (error) {
    return {
      configured: true,
      url: clipVisionApiUrl,
      reachable: false,
      detail: error instanceof Error ? error.message : "unreachable",
    };
  }
}

/**
 * Call deedlit.vision POST /embed/image with raw bytes.
 * Sends the image as multipart form-data and returns the L2-normalized CLIP
 * embedding vector.  Shared by file-path and in-memory (pasted/uploaded) paths.
 */
async function callVisionApiImageBuffer(
  buffer: Buffer,
  mime: string,
  filename: string,
): Promise<number[]> {
  const { clipVisionApiUrl } = getLibraryConfig();
  // Copy into a fresh ArrayBuffer-backed view so Blob accepts it as a BlobPart
  // (a Node Buffer is typed over ArrayBufferLike, which Blob's types reject).
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), filename);

  const res = await fetch(`${clipVisionApiUrl}/embed/image`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`deedlit.vision /embed/image ${res.status}: ${text}`);
  }
  const json = await res.json() as { embedding: number[] };
  return json.embedding;
}

function mimeForExtension(ext: string): string {
  return ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
}

async function callVisionApiImage(imagePath: string): Promise<number[]> {
  const buffer = await readFile(imagePath);
  const filename = path.basename(imagePath);
  return callVisionApiImageBuffer(buffer, mimeForExtension(path.extname(filename).toLowerCase()), filename);
}

/**
 * Call deedlit.vision POST /embed/text.
 * Returns the L2-normalized CLIP text embedding vector.
 */
async function callVisionApiText(text: string): Promise<number[]> {
  const { clipVisionApiUrl } = getLibraryConfig();
  const res = await fetch(`${clipVisionApiUrl}/embed/text`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`deedlit.vision /embed/text ${res.status}: ${t}`);
  }
  const json = await res.json() as { embedding: number[] };
  return json.embedding;
}

/** Thrown when deedlit.vision is required but not configured. */
export class VisionServiceNotConfiguredError extends Error {
  constructor() {
    super(
      "CLIP_VISION_API_URL is not set — the deedlit.vision service is required for embeddings. " +
        "There is no local fallback; start deedlit.vision and set CLIP_VISION_API_URL (e.g. http://localhost:8000).",
    );
    this.name = "VisionServiceNotConfiguredError";
  }
}

export async function generateImageEmbedding(imagePath: string): Promise<number[]> {
  const { clipVisionApiUrl } = getLibraryConfig();
  // deedlit.vision is MANDATORY — there is no in-process fallback. A missing
  // service throws so callers (upsert / search routes) skip indexing rather than
  // silently storing a non-semantic vector. (Errors are also never swallowed
  // into a zero vector, which would poison Qdrant with cosine-0-against-all.)
  if (!clipVisionApiUrl) {
    throw new VisionServiceNotConfiguredError();
  }
  return callVisionApiImage(imagePath);
}

/**
 * Embed an in-memory image (pasted/uploaded by the user, never persisted) using
 * the same pipeline as indexed images, so its vector lands in the same space and
 * can be matched against the Qdrant collection.  Requires deedlit.vision.
 */
export async function generateImageEmbeddingFromBuffer(
  buffer: Buffer,
  mime = "image/png",
  filename = "pasted-image",
): Promise<number[]> {
  const { clipVisionApiUrl } = getLibraryConfig();
  if (!clipVisionApiUrl) {
    throw new VisionServiceNotConfiguredError();
  }
  return callVisionApiImageBuffer(buffer, mime, filename);
}

/**
 * Text query embedding via the deedlit.vision CLIP text tower (same embedding
 * space as images → true semantic search).  Requires deedlit.vision — there is
 * no local hashed-token fallback (it was never aligned with image vectors, so a
 * fallback query silently returned irrelevant results).
 */
export async function generateTextEmbedding(text: string): Promise<number[]> {
  const { clipVisionApiUrl } = getLibraryConfig();
  if (!clipVisionApiUrl) {
    throw new VisionServiceNotConfiguredError();
  }
  return callVisionApiText(text);
}

function embeddingKey(sha256: string): string {
  const dims = getLibraryConfig().embeddingDimensions;
  const provider = getEmbeddingProvider();
  return `embeddings/${provider}-${dims}/${sha256.slice(0, 2)}/${sha256}.json`;
}

/**
 * Image embedding with object-store cache keyed by (provider, sha256).
 * Falls back to direct computation when object storage is disabled.
 */
export async function getOrComputeImageEmbedding(imagePath: string, sha256: string): Promise<number[]> {
  if (!isObjectStoreEnabled()) {
    return generateImageEmbedding(imagePath);
  }
  const key = embeddingKey(sha256);
  const cached = await getObjectBuffer(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached.toString("utf8")) as { vector?: number[] };
      // Reject cached zero vectors — legacy poison from the old "return zeros on
      // failure" path. Recompute instead of serving a dead embedding.
      if (
        Array.isArray(parsed.vector) &&
        parsed.vector.length === getLibraryConfig().embeddingDimensions &&
        !isZeroVector(parsed.vector)
      ) {
        return parsed.vector;
      }
    } catch {
      // fall through and recompute
    }
  }
  const vector = await generateImageEmbedding(imagePath);
  if (!isZeroVector(vector)) {
    await putObject(key, JSON.stringify({ sha256, vector }), "application/json").catch((error) =>
      logger.warn({ err: error, sha256 }, "failed to cache embedding"),
    );
  }
  return vector;
}
