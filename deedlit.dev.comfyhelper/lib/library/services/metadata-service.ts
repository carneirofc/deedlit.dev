import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { readEmbeddedMetadataFromPng } from "@/lib/png-metadata";
import {
  extractFromComfyPromptGraph,
  findFirstValueByKeys,
  getSearchableMetadata,
  isRecord,
  maybeParseJsonString,
  parseAutomatic1111Parameters,
  toDisplayValue,
} from "@/lib/metadata-parsing";
import { normalizeTag } from "@/lib/prompt-tags";

export const SUPPORTED_EXTENSIONS = new Set([".png", ".webp", ".jpg", ".jpeg"]);

export interface ExtractedLora {
  name: string;
  weight: number | null;
}

export interface ExtractedGenerationParams {
  seed: number | null;
  steps: number | null;
  cfgScale: number | null;
  sampler: string | null;
  scheduler: string | null;
  denoise: number | null;
  width: number | null;
  height: number | null;
  clipSkip: number | null;
}

export interface ExtractedImageRecord {
  filePath: string;
  filename: string;
  extension: string;
  sha256Hash: string;
  perceptualHash: string | null;
  width: number | null;
  height: number | null;
  fileSizeBytes: number;
  createdAt: Date | null;
  modifiedAt: Date | null;
  sourceTool: string | null;
  prompt: string | null;
  negativePrompt: string | null;
  model: string | null;
  workflowJson: unknown;
  metadataJson: unknown;
  tags: string[];
  loras: ExtractedLora[];
  generationParams: ExtractedGenerationParams;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * 64-bit average hash (aHash): downscale to 8x8 grayscale, threshold against the
 * mean, emit a 16-char hex string.  Good enough for near-duplicate detection.
 */
export async function computePerceptualHash(filePath: string): Promise<string | null> {
  try {
    const data = await sharp(filePath).greyscale().resize(8, 8, { fit: "fill" }).raw().toBuffer();
    let sum = 0;
    for (const value of data) sum += value;
    const mean = sum / data.length;
    let bits = "";
    for (const value of data) bits += value >= mean ? "1" : "0";
    let hex = "";
    for (let i = 0; i < 64; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt / lora / param parsing
// ---------------------------------------------------------------------------

/** Parse `<lora:name:0.8>` and `<lyco:name:0.8>` references from a prompt. */
export function parseLorasFromPrompt(prompt: string | null | undefined): ExtractedLora[] {
  if (!prompt) return [];
  const out: ExtractedLora[] = [];
  const re = /<(?:lora|lyco):([^:>]+)(?::([0-9.]+))?[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt)) !== null) {
    out.push({ name: match[1].trim(), weight: match[2] ? Number.parseFloat(match[2]) : null });
  }
  return out;
}

/**
 * Clean a single prompt token into a canonical tag:
 * - drop Automatic1111 emphasis weights (`tag:0.65`) and BREAK separators
 * - unwrap balanced emphasis brackets (`(tag)`, `((tag))`, `[tag]`) without
 *   touching legitimate parenthetical booru tags like `taimanin (series)`
 * - unescape `\(` / `\)` and collapse whitespace
 */
function cleanPromptTag(raw: string): string {
  let t = raw.replace(/\\/g, "").replace(/:\s*\d+(?:\.\d+)?/g, "").trim();
  while (/^[([{<]/.test(t) && /[)\]}>]$/.test(t)) {
    t = t.slice(1, -1).trim();
  }
  // Weighted groups can span commas (`((a:0.9), (b))`), leaving a stray bracket
  // after the split. Trim leading/trailing brackets only when unbalanced so
  // legitimate parenthetical tags like `taimanin (series)` are preserved.
  const opens = (t.match(/[([{]/g) ?? []).length;
  const closes = (t.match(/[)\]}]/g) ?? []).length;
  if (opens !== closes) {
    t = t.replace(/^[([{<]+/, "").replace(/[)\]}>]+$/, "").trim();
  }
  return t.replace(/\s+/g, " ").trim();
}

const STOP_TOKENS = new Set(["break", "and", "", "lora", "embedding"]);

/** Strip lora/lyco tags and extract comma/newline-separated booru-style tags. */
export function normalizePromptTags(prompt: string | null | undefined): string[] {
  if (!prompt) return [];
  const withoutLoras = prompt.replace(/<(?:lora|lyco):[^>]*>/gi, " ");
  // A1111 prompts mix commas and newlines as separators; treat both.
  const normalizedSeparators = withoutLoras.replace(/[\r\n]+/g, ",").replace(/\bBREAK\b/g, ",");
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const piece of normalizedSeparators.split(",")) {
    const cleaned = normalizeTag(cleanPromptTag(piece));
    if (!cleaned || STOP_TOKENS.has(cleaned) || cleaned.length > 80) continue;
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      tags.push(cleaned);
    }
  }
  return tags;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseSizeString(size: string | undefined): { width: number | null; height: number | null } {
  if (!size) return { width: null, height: null };
  const match = size.match(/(\d+)\s*[x×]\s*(\d+)/);
  if (!match) return { width: null, height: null };
  return { width: Number.parseInt(match[1], 10), height: Number.parseInt(match[2], 10) };
}

// ---------------------------------------------------------------------------
// Embedded metadata extraction (PNG text chunks + sharp for webp/jpeg)
// ---------------------------------------------------------------------------

async function extractEmbeddedMetadata(filePath: string, extension: string): Promise<unknown> {
  if (extension === ".png") {
    const { metadata } = await readEmbeddedMetadataFromPng(filePath);
    return metadata ?? null;
  }
  // webp/jpeg: surface EXIF/XMP/text if sharp exposes it.
  try {
    const meta = await sharp(filePath).metadata();
    const fields: Record<string, unknown> = {};
    if (meta.exif) fields.exif = meta.exif.toString("latin1");
    const extra = meta as unknown as { comments?: Array<{ keyword: string; text: string }> };
    if (Array.isArray(extra.comments)) {
      for (const c of extra.comments) fields[c.keyword] = c.text;
    }
    return Object.keys(fields).length > 0 ? { source: "embedded-image", fields } : null;
  } catch {
    return null;
  }
}

/**
 * Pull the canonical prompt/param view out of whatever embedded metadata shape
 * we found.  Handles ComfyUI (`prompt` graph + `workflow`) and Automatic1111
 * (`parameters` string), falling back gracefully.
 */
function interpretMetadata(metadata: unknown): {
  prompt: string | null;
  negativePrompt: string | null;
  model: string | null;
  sourceTool: string | null;
  workflowJson: unknown;
  params: Partial<ExtractedGenerationParams>;
} {
  const searchable = getSearchableMetadata(metadata);

  // Automatic1111 / Forge style: a `parameters` text blob.
  const parametersRaw = toDisplayValue(findFirstValueByKeys(searchable, ["parameters"]));
  let sourceTool: string | null = null;
  let prompt: string | null = null;
  let negativePrompt: string | null = null;
  let model: string | null = null;
  const params: Partial<ExtractedGenerationParams> = {};

  if (parametersRaw) {
    const a1111 = parseAutomatic1111Parameters(parametersRaw, { includeFirstLineAsPositive: true });
    sourceTool = "automatic1111";
    prompt = a1111.positivePrompt ?? null;
    negativePrompt = a1111.negativePrompt ?? null;
    model = a1111.model ?? null;
    params.seed = toNumber(a1111.seed);
    params.steps = toNumber(a1111.steps);
    params.cfgScale = toNumber(a1111.cfgScale);
    params.sampler = a1111.sampler ?? null;
    params.scheduler = a1111.scheduler ?? null;
    const size = parseSizeString(a1111.size);
    params.width = size.width;
    params.height = size.height;
  }

  // ComfyUI style: a `prompt` field containing a node graph.
  const comfyPrompt = findFirstValueByKeys(searchable, ["prompt"]);
  const workflow = findFirstValueByKeys(searchable, ["workflow"]);
  if (comfyPrompt && isRecord(maybeParseJsonString(comfyPrompt))) {
    const comfy = extractFromComfyPromptGraph(comfyPrompt);
    if (comfy.positivePrompt || comfy.model) {
      sourceTool = sourceTool ?? "comfyui";
      prompt = prompt ?? comfy.positivePrompt ?? null;
      negativePrompt = negativePrompt ?? comfy.negativePrompt ?? null;
      model = model ?? comfy.model ?? null;
      params.seed = params.seed ?? toNumber(comfy.seed);
      params.steps = params.steps ?? toNumber(comfy.steps);
      params.cfgScale = params.cfgScale ?? toNumber(comfy.cfgScale);
      params.sampler = params.sampler ?? comfy.sampler ?? null;
      params.scheduler = params.scheduler ?? comfy.scheduler ?? null;
    }
  }

  return {
    prompt,
    negativePrompt,
    model,
    sourceTool,
    workflowJson: workflow ? maybeParseJsonString(workflow) : null,
    params,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function extractImageMetadata(filePath: string): Promise<ExtractedImageRecord> {
  const extension = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);
  const fileStat = await stat(filePath);

  const [sha256Hash, perceptualHash, dims, embedded] = await Promise.all([
    computeSha256(filePath),
    computePerceptualHash(filePath),
    sharp(filePath)
      .metadata()
      .then((m) => ({ width: m.width ?? null, height: m.height ?? null }))
      .catch(() => ({ width: null, height: null })),
    extractEmbeddedMetadata(filePath, extension),
  ]);

  const interpreted = interpretMetadata(embedded);
  const tags = normalizePromptTags(interpreted.prompt);
  const loras = parseLorasFromPrompt(interpreted.prompt);

  const generationParams: ExtractedGenerationParams = {
    seed: interpreted.params.seed ?? null,
    steps: interpreted.params.steps ?? null,
    cfgScale: interpreted.params.cfgScale ?? null,
    sampler: interpreted.params.sampler ?? null,
    scheduler: interpreted.params.scheduler ?? null,
    denoise: interpreted.params.denoise ?? null,
    width: interpreted.params.width ?? dims.width,
    height: interpreted.params.height ?? dims.height,
    clipSkip: interpreted.params.clipSkip ?? null,
  };

  return {
    filePath,
    filename,
    extension,
    sha256Hash,
    perceptualHash,
    width: dims.width,
    height: dims.height,
    fileSizeBytes: fileStat.size,
    createdAt: fileStat.birthtime ?? null,
    modifiedAt: fileStat.mtime ?? null,
    sourceTool: interpreted.sourceTool,
    prompt: interpreted.prompt,
    negativePrompt: interpreted.negativePrompt,
    model: interpreted.model,
    workflowJson: interpreted.workflowJson,
    metadataJson: embedded,
    tags,
    loras,
    generationParams,
  };
}
