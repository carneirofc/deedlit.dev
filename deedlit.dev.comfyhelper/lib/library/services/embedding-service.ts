import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { getLogger } from "@/lib/logger";
import { getLibraryConfig } from "@/lib/library/config";
import { getObjectBuffer, isObjectStoreEnabled, putObject } from "@/lib/library/storage/object-store";

const logger = getLogger({ scope: "library-embedding" });

export function getEmbeddingProvider(): string {
  const { clipVisionApiUrl, enrichment } = getLibraryConfig();
  if (clipVisionApiUrl) return "deedlit-vision";
  return enrichment.imageEmbeddingProvider;
}

/** Whether a real (learned) image-embedding provider is configured. */
export function hasExternalImageEmbeddings(): boolean {
  const { clipVisionApiUrl } = getLibraryConfig();
  if (clipVisionApiUrl) return true;
  const provider = getLibraryConfig().enrichment.imageEmbeddingProvider;
  return provider !== "" && provider !== "local" && provider !== "none";
}

function l2normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

function scaleBlock(vec: number[], weight: number): number[] {
  return weight === 1 ? vec : vec.map((v) => v * weight);
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
      detail: "CLIP_VISION_API_URL not set — using local pixel-histogram fallback.",
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

/**
 * Local visual feature vector (pixel-histogram fallback).
 * Used when deedlit.vision is not configured.  Not semantically aligned with
 * text vectors — similarity search falls back to metadata in that case.
 */
async function localImageEmbedding(input: string | Buffer): Promise<number[]> {
  const dims = getLibraryConfig().embeddingDimensions;
  const grid = 12;
  const { data } = await sharp(input)
    .removeAlpha()
    .resize(grid, grid, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Downscaled-grid block (432 dims): coarse layout + color positioning.
  const gridVec: number[] = [];
  for (const v of data) gridVec.push(v / 255);

  // Color-histogram block (48 dims): palette, independent of position.
  const bins = 16;
  const hist = new Array(bins * 3).fill(0);
  for (let i = 0; i < data.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const bin = Math.min(bins - 1, Math.floor((data[i + c] / 256) * bins));
      hist[c * bins + bin] += 1;
    }
  }
  const pixels = data.length / 3 || 1;
  const histVec = hist.map((h) => h / pixels);

  // L2-normalize each block independently so the 432-dim grid block does not
  // numerically swamp the 48-dim histogram block (a single L2 over the raw
  // concatenation let the grid dominate → similarity collapsed to "same coarse
  // layout"). Weight the palette block up since the grid is position-sensitive.
  const gridBlock = scaleBlock(l2normalize(gridVec), 1.0);
  const histBlock = scaleBlock(l2normalize(histVec), 1.3);

  let vec = [...gridBlock, ...histBlock];
  if (vec.length < dims) vec = vec.concat(new Array(dims - vec.length).fill(0));
  else if (vec.length > dims) vec = vec.slice(0, dims);

  return l2normalize(vec);
}

export async function generateImageEmbedding(imagePath: string): Promise<number[]> {
  const { clipVisionApiUrl } = getLibraryConfig();
  // Intentionally NOT swallowing errors into a zero vector: a zero vector
  // pollutes Qdrant (cosine 0 against everything) and, once cached, persists.
  // Callers (upsert / search routes) handle the throw and skip indexing.
  if (clipVisionApiUrl) {
    return callVisionApiImage(imagePath);
  }
  return localImageEmbedding(imagePath);
}

/**
 * Embed an in-memory image (pasted/uploaded by the user, never persisted) using
 * the same pipeline as indexed images, so its vector lands in the same space and
 * can be matched against the Qdrant collection.  Note: the local pixel-histogram
 * fallback IS aligned image-to-image (unlike text), so reverse-image search works
 * even when deedlit.vision/CLIP is not configured.
 */
export async function generateImageEmbeddingFromBuffer(
  buffer: Buffer,
  mime = "image/png",
  filename = "pasted-image",
): Promise<number[]> {
  const { clipVisionApiUrl } = getLibraryConfig();
  // Throws on failure (see generateImageEmbedding) so reverse-image search
  // surfaces a real error instead of matching everything at score 0.
  if (clipVisionApiUrl) {
    return callVisionApiImageBuffer(buffer, mime, filename);
  }
  return localImageEmbedding(buffer);
}

/**
 * Text query embedding.
 * When deedlit.vision is configured, uses the CLIP text tower (same embedding
 * space as images → true semantic search).  Otherwise falls back to a local
 * hashed bag-of-tokens vector that is NOT aligned with image vectors.
 */
export async function generateTextEmbedding(text: string): Promise<number[]> {
  const { clipVisionApiUrl, embeddingDimensions } = getLibraryConfig();
  if (clipVisionApiUrl) {
    try {
      return await callVisionApiText(text);
    } catch (error) {
      logger.warn({ err: error, text }, "Vision API text embed failed; falling back to local hash vector");
    }
  }

  const dims = embeddingDimensions;
  const vec = new Array(dims).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    vec[Math.abs(h) % dims] += 1;
  }
  return l2normalize(vec);
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
