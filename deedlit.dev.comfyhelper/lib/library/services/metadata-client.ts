import { readFile } from "node:fs/promises";
import path from "node:path";

import { getLibraryConfig } from "@/lib/library/config";

/**
 * HTTP client for the stateless `deedlit.metadata` service.
 *
 * Replaces the monolith's in-process PNG metadata parsing (A1111 `parameters`
 * blob + ComfyUI node graph) with a call to `POST /extract`. The service does
 * NOT do any pixel work (sha256 / phash / dims / thumbnail) — that stays in the
 * ingest pipeline. See contracts/metadata.openapi.yaml.
 */

/** One referenced asset resolved from the ComfyUI node graph. */
export interface ExtractAssetRef {
  name: string;
  hash?: string | null;
}

/** Full asset-reference graph (all six categories always present). */
export interface ExtractReferences {
  checkpoints: ExtractAssetRef[];
  loras: ExtractAssetRef[];
  embeddings: ExtractAssetRef[];
  vae: ExtractAssetRef[];
  controlnets: ExtractAssetRef[];
  upscalers: ExtractAssetRef[];
}

/** Generation params as produced by the metadata service (snake-ish contract). */
export interface ExtractParams {
  seed?: number | null;
  steps?: number | null;
  cfg?: number | null;
  sampler?: string | null;
  scheduler?: string | null;
  denoise?: number | null;
  clipskip?: number | null;
  width?: number | null;
  height?: number | null;
}

/** The `ExtractResult` payload returned by `POST /extract` (200). */
export interface ExtractResult {
  sourceTool: "a1111" | "comfyui" | "unknown";
  prompt?: string | null;
  negative?: string | null;
  tags: string[];
  params: ExtractParams;
  references: ExtractReferences;
  workflow_json?: Record<string, unknown> | null;
  api_prompt_json?: Record<string, unknown> | null;
}

/** Thrown when the metadata service is not configured. */
export class MetadataServiceNotConfiguredError extends Error {
  constructor() {
    super(
      "METADATA_API_URL is not set — the deedlit.metadata service is required for ingest. " +
        "Start deedlit.metadata and set METADATA_API_URL (e.g. http://localhost:8005).",
    );
    this.name = "MetadataServiceNotConfiguredError";
  }
}

function mimeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

/** A "no recognized metadata" (HTTP 422) result, in the ExtractResult shape. */
function emptyExtractResult(): ExtractResult {
  return {
    sourceTool: "unknown",
    prompt: null,
    negative: null,
    tags: [],
    params: {},
    references: {
      checkpoints: [],
      loras: [],
      embeddings: [],
      vae: [],
      controlnets: [],
      upscalers: [],
    },
    workflow_json: null,
    api_prompt_json: null,
  };
}

/**
 * Call `deedlit.metadata POST /extract` with raw image bytes (multipart `file`).
 *
 * - 200 → the parsed {@link ExtractResult}.
 * - 422 → no recognized metadata: returns an empty `unknown`-sourced result so
 *   ingest still records the (pixel-only) image instead of failing the file.
 * - anything else (incl. unreachable) → throws, so a misconfigured/down service
 *   surfaces as a real error rather than silently dropping all metadata.
 */
export async function extractMetadataFromBuffer(
  buffer: Buffer,
  mime: string,
  filename: string,
): Promise<ExtractResult> {
  const { metadataApiUrl } = getLibraryConfig();
  if (!metadataApiUrl) {
    throw new MetadataServiceNotConfiguredError();
  }

  // Copy into a fresh ArrayBuffer-backed view so Blob accepts it as a BlobPart
  // (a Node Buffer is typed over ArrayBufferLike, which Blob's types reject).
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), filename);

  const res = await fetch(`${metadataApiUrl}/extract`, { method: "POST", body: form });
  if (res.status === 422) {
    // Service parsed the file but found no recognized A1111/ComfyUI metadata.
    return emptyExtractResult();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`deedlit.metadata /extract ${res.status}: ${text}`);
  }
  return (await res.json()) as ExtractResult;
}

/** Read a file from disk and extract its metadata via the service. */
export async function extractMetadataFromFile(filePath: string): Promise<ExtractResult> {
  const buffer = await readFile(filePath);
  const filename = path.basename(filePath);
  return extractMetadataFromBuffer(buffer, mimeForExtension(path.extname(filename)), filename);
}
