import type { ImageRecord, PromptStatistics, TagMetric } from "@/lib/library-types";
import { extractTagsFromPrompt } from "@/lib/prompt-tags";

export type PromptInsights = {
  positivePrompt?: string;
  negativePrompt?: string;
  model?: string;
  sampler?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function maybeParseJsonString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed || !(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function toDisplayValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function findFirstValueByKeys(root: unknown, keys: string[]): unknown {
  if (!root) {
    return undefined;
  }

  const keySet = new Set(keys.map((key) => normalizeKey(key)));
  const seen = new Set<unknown>();

  const visit = (value: unknown): unknown => {
    const parsed = maybeParseJsonString(value);
    if (!isRecord(parsed)) {
      return undefined;
    }

    if (seen.has(parsed)) {
      return undefined;
    }
    seen.add(parsed);

    for (const [key, nestedValue] of Object.entries(parsed)) {
      if (keySet.has(normalizeKey(key))) {
        return nestedValue;
      }
    }

    for (const nestedValue of Object.values(parsed)) {
      const found = visit(nestedValue);
      if (found !== undefined) {
        return found;
      }
    }

    return undefined;
  };

  return visit(root);
}

function resolveNodeReference(value: unknown): string | null {
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "string" || typeof first === "number") {
      return String(first);
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return null;
}

function extractTextFromPromptNode(
  nodeId: string | null,
  nodes: Record<string, { classType?: string; inputs?: Record<string, unknown> }>,
): string | undefined {
  if (!nodeId) {
    return undefined;
  }

  const node = nodes[nodeId];
  if (!node?.inputs) {
    return undefined;
  }

  const parts = [toDisplayValue(node.inputs.text), toDisplayValue(node.inputs.text_g), toDisplayValue(node.inputs.text_l)]
    .filter((value): value is string => Boolean(value));
  if (parts.length === 0) {
    return undefined;
  }

  return parts.join("\n");
}

function extractFromComfyPromptGraph(promptValue: unknown): Partial<PromptInsights> {
  const parsedPrompt = maybeParseJsonString(promptValue);
  if (!isRecord(parsedPrompt)) {
    return {};
  }

  const nodes: Record<string, { classType?: string; inputs?: Record<string, unknown> }> = {};
  for (const [nodeId, nodeValue] of Object.entries(parsedPrompt)) {
    if (!isRecord(nodeValue)) {
      continue;
    }
    const classType = toDisplayValue(nodeValue.class_type);
    const inputs = isRecord(nodeValue.inputs) ? nodeValue.inputs : undefined;
    if (!classType || !inputs) {
      continue;
    }
    nodes[nodeId] = { classType, inputs };
  }

  const kSamplerEntry = Object.entries(nodes).find(([, node]) =>
    (node.classType ?? "").toLowerCase().includes("ksampler"),
  );
  if (!kSamplerEntry) {
    return {};
  }

  const [, samplerNode] = kSamplerEntry;
  const inputs = samplerNode.inputs ?? {};
  const positiveRef = resolveNodeReference(inputs.positive);
  const negativeRef = resolveNodeReference(inputs.negative);
  const modelRef = resolveNodeReference(inputs.model);

  let modelName: string | undefined;
  if (modelRef && nodes[modelRef]?.inputs) {
    const modelInputs = nodes[modelRef].inputs ?? {};
    modelName =
      toDisplayValue(modelInputs.ckpt_name) ??
      toDisplayValue(modelInputs.model_name) ??
      toDisplayValue(modelInputs.unet_name);
  }

  if (!modelName) {
    const loaderNode = Object.values(nodes).find((node) => {
      const classType = (node.classType ?? "").toLowerCase();
      return classType.includes("checkpointloader") || classType.includes("unetloader");
    });
    if (loaderNode?.inputs) {
      modelName =
        toDisplayValue(loaderNode.inputs.ckpt_name) ??
        toDisplayValue(loaderNode.inputs.model_name) ??
        toDisplayValue(loaderNode.inputs.unet_name);
    }
  }

  return {
    positivePrompt: extractTextFromPromptNode(positiveRef, nodes),
    negativePrompt: extractTextFromPromptNode(negativeRef, nodes),
    model: modelName,
    sampler: toDisplayValue(inputs.sampler_name),
  };
}

function parseAutomatic1111Parameters(parameters: string): Partial<PromptInsights> {
  const result: Partial<PromptInsights> = {};
  const text = parameters.trim();
  if (!text) {
    return result;
  }

  const negativeLabel = "Negative prompt:";
  const negativeIndex = text.indexOf(negativeLabel);
  if (negativeIndex >= 0) {
    const positivePart = text.slice(0, negativeIndex).trim();
    if (positivePart) {
      result.positivePrompt = positivePart;
    }

    const afterNegative = text.slice(negativeIndex + negativeLabel.length);
    const settingsStart = afterNegative.search(/\n(?:Steps|Sampler|CFG scale|Seed|Size|Model):/i);
    const negativePart = settingsStart >= 0 ? afterNegative.slice(0, settingsStart).trim() : afterNegative.trim();
    if (negativePart) {
      result.negativePrompt = negativePart;
    }
  }

  const modelMatch = text.match(/Model:\s*([^,\n]+)/i);
  if (modelMatch?.[1]) {
    result.model = modelMatch[1].trim();
  }

  const samplerMatch = text.match(/Sampler:\s*([^,\n]+)/i);
  if (samplerMatch?.[1]) {
    result.sampler = samplerMatch[1].trim();
  }

  return result;
}

function extractPromptTextFromMetadata(metadata: unknown, keys: string[]): string | undefined {
  const value = findFirstValueByKeys(metadata, keys);
  return toDisplayValue(value);
}

export function extractPromptInsightsFromMetadata(metadata: unknown): PromptInsights {
  const searchableMetadata = isRecord(metadata) && isRecord(metadata.fields) ? metadata.fields : metadata;

  const parametersValue = findFirstValueByKeys(searchableMetadata, ["parameters"]);
  const parametersText = toDisplayValue(parametersValue);
  const parsedParameters = parametersText ? parseAutomatic1111Parameters(parametersText) : {};

  const comfyPromptValue = findFirstValueByKeys(searchableMetadata, ["prompt"]);
  const parsedComfy = extractFromComfyPromptGraph(comfyPromptValue);

  const fallbackPositive = extractPromptTextFromMetadata(searchableMetadata, [
    "positive",
    "positive_prompt",
    "prompt",
    "text",
    "prompt_text",
    "text_g",
    "text_l",
  ]);
  const fallbackNegative = extractPromptTextFromMetadata(searchableMetadata, [
    "negative",
    "negative_prompt",
    "negative_text",
    "uc",
    "uncond",
  ]);
  const fallbackModel = toDisplayValue(
    findFirstValueByKeys(searchableMetadata, ["model", "model_name", "ckpt_name", "checkpoint"]),
  );
  const fallbackSampler = toDisplayValue(
    findFirstValueByKeys(searchableMetadata, ["sampler", "sampler_name"]),
  );

  return {
    positivePrompt: parsedComfy.positivePrompt ?? parsedParameters.positivePrompt ?? fallbackPositive,
    negativePrompt: parsedComfy.negativePrompt ?? parsedParameters.negativePrompt ?? fallbackNegative,
    model: parsedComfy.model ?? parsedParameters.model ?? fallbackModel,
    sampler: parsedComfy.sampler ?? parsedParameters.sampler ?? fallbackSampler,
  };
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function isGraphReferenceLabel(value: string): boolean {
  const compact = value.replace(/\s+/g, "").replace(/\\/g, "");
  return /^\[(["'])?\d+(["'])?,\d+\]$/.test(compact);
}

function toMetricLabel(value?: string): string | null {
  if (!value) {
    return null;
  }

  const label = normalizeTag(value);
  if (!label || isGraphReferenceLabel(label)) {
    return null;
  }

  return label;
}

function incrementCount(target: Map<string, number>, key: string): void {
  target.set(key, (target.get(key) ?? 0) + 1);
}

function toTopMetrics(counts: Map<string, number>, max = 15): TagMetric[] {
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, max);
}

function roundTo(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export type PromptStatisticsAccumulator = {
  totalImages: number;
  imagesWithPositivePrompt: number;
  imagesWithNegativePrompt: number;
  imagesWithModel: number;
  imagesWithSampler: number;
  positiveTagTotal: number;
  negativeTagTotal: number;
  positiveTagCounts: Map<string, number>;
  negativeTagCounts: Map<string, number>;
  modelCounts: Map<string, number>;
  samplerCounts: Map<string, number>;
  excludedTags: ReadonlySet<string>;
};

type CreatePromptStatisticsAccumulatorOptions = {
  excludedTags?: ReadonlySet<string> | readonly string[];
};

function toExcludedTagSet(excludedTags?: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  if (!excludedTags) {
    return new Set<string>();
  }

  const entries = Array.isArray(excludedTags) ? excludedTags : Array.from(excludedTags);
  return new Set(entries.map((tag) => normalizeTag(tag.trim())).filter((tag) => tag.length > 1));
}

export function createPromptStatisticsAccumulator(
  options: CreatePromptStatisticsAccumulatorOptions = {},
): PromptStatisticsAccumulator {
  return {
    totalImages: 0,
    imagesWithPositivePrompt: 0,
    imagesWithNegativePrompt: 0,
    imagesWithModel: 0,
    imagesWithSampler: 0,
    positiveTagTotal: 0,
    negativeTagTotal: 0,
    positiveTagCounts: new Map<string, number>(),
    negativeTagCounts: new Map<string, number>(),
    modelCounts: new Map<string, number>(),
    samplerCounts: new Map<string, number>(),
    excludedTags: toExcludedTagSet(options.excludedTags),
  };
}

export function accumulatePromptStatisticsMetadata(
  accumulator: PromptStatisticsAccumulator,
  metadata: unknown,
): void {
  accumulator.totalImages += 1;
  const insights = extractPromptInsightsFromMetadata(metadata);

  const positiveTags = extractTagsFromPrompt(insights.positivePrompt, { exclude: accumulator.excludedTags });
  const negativeTags = extractTagsFromPrompt(insights.negativePrompt, { exclude: accumulator.excludedTags });

  if (insights.positivePrompt) {
    accumulator.imagesWithPositivePrompt += 1;
  }
  if (insights.negativePrompt) {
    accumulator.imagesWithNegativePrompt += 1;
  }
  if (insights.model) {
    const modelLabel = toMetricLabel(insights.model);
    if (modelLabel) {
      accumulator.imagesWithModel += 1;
      incrementCount(accumulator.modelCounts, modelLabel);
    }
  }
  if (insights.sampler) {
    const samplerLabel = toMetricLabel(insights.sampler);
    if (samplerLabel) {
      accumulator.imagesWithSampler += 1;
      incrementCount(accumulator.samplerCounts, samplerLabel);
    }
  }

  accumulator.positiveTagTotal += positiveTags.length;
  accumulator.negativeTagTotal += negativeTags.length;
  for (const tag of positiveTags) {
    incrementCount(accumulator.positiveTagCounts, tag);
  }
  for (const tag of negativeTags) {
    incrementCount(accumulator.negativeTagCounts, tag);
  }
}

export function finalizePromptStatistics(accumulator: PromptStatisticsAccumulator): PromptStatistics {
  const totalImages = accumulator.totalImages;

  return {
    totalImages,
    imagesWithPositivePrompt: accumulator.imagesWithPositivePrompt,
    imagesWithNegativePrompt: accumulator.imagesWithNegativePrompt,
    imagesWithModel: accumulator.imagesWithModel,
    imagesWithSampler: accumulator.imagesWithSampler,
    uniquePositiveTags: accumulator.positiveTagCounts.size,
    uniqueNegativeTags: accumulator.negativeTagCounts.size,
    avgPositiveTagsPerImage: totalImages > 0 ? roundTo(accumulator.positiveTagTotal / totalImages) : 0,
    avgNegativeTagsPerImage: totalImages > 0 ? roundTo(accumulator.negativeTagTotal / totalImages) : 0,
    topPositiveTags: toTopMetrics(accumulator.positiveTagCounts),
    topNegativeTags: toTopMetrics(accumulator.negativeTagCounts),
    topModels: toTopMetrics(accumulator.modelCounts, 10),
    topSamplers: toTopMetrics(accumulator.samplerCounts, 10),
    generatedAt: new Date().toISOString(),
  };
}

export function buildPromptStatistics(images: ImageRecord[]): PromptStatistics {
  const accumulator = createPromptStatisticsAccumulator();
  for (const image of images) {
    accumulatePromptStatisticsMetadata(accumulator, image.metadata);
  }

  return finalizePromptStatistics(accumulator);
}

/**
 * Accumulate an entire batch of pre-parsed metadata objects into the
 * accumulator in one call. Returns the number of items processed.
 */
export function accumulateMetadataBatch(
  accumulator: PromptStatisticsAccumulator,
  metadataItems: unknown[],
): number {
  for (const metadata of metadataItems) {
    accumulatePromptStatisticsMetadata(accumulator, metadata);
  }
  return metadataItems.length;
}

/**
 * Streaming statistics event emitted for each batch processed.
 */
export type StreamingStatsEvent = {
  /** "batch" for intermediate results, "complete" for the final result */
  type: "batch" | "complete";
  /** Running / final statistics snapshot */
  stats: PromptStatistics;
  /** Number of images processed in this batch */
  batchSize: number;
  /** Cumulative total images processed so far */
  processedTotal: number;
  /** The root being processed (if applicable) */
  rootId?: string;
  /** Whether this is the final event */
  isLast: boolean;
  /** Elapsed time in ms since the stream started */
  elapsedMs: number;
};

/**
 * Async generator that consumes a metadata batch stream and yields
 * intermediate `PromptStatistics` snapshots after every batch. This allows
 * callers (e.g. an SSE endpoint) to push partial results to the client
 * while processing is still in progress.
 *
 * The final yield has `type === "complete"` and `isLast === true`.
 */
export async function* streamPromptStatistics(
  metadataStream: AsyncIterable<{
    items: unknown[];
    batchSize: number;
    processedTotal: number;
    rootId: string;
    isLast: boolean;
  }>,
  options?: {
    excludedTags?: ReadonlySet<string> | readonly string[];
  },
): AsyncGenerator<StreamingStatsEvent> {
  const accumulator = createPromptStatisticsAccumulator({
    excludedTags: options?.excludedTags,
  });
  const startMs = Date.now();

  console.info(
    `[streamStats] starting streaming statistics accumulation`,
  );

  for await (const batch of metadataStream) {
    const batchStartMs = Date.now();
    const count = accumulateMetadataBatch(accumulator, batch.items);
    const accMs = Date.now() - batchStartMs;
    const elapsedMs = Date.now() - startMs;

    console.info(
      `[streamStats] batch accumulated root=${batch.rootId} batchRows=${count} totalImages=${accumulator.totalImages} uniquePosTags=${accumulator.positiveTagCounts.size} accMs=${accMs} elapsedMs=${elapsedMs}`,
    );

    const snapshot = finalizePromptStatistics(accumulator);

    if (batch.isLast) {
      console.info(
        `[streamStats] stream complete totalImages=${snapshot.totalImages} uniquePosTags=${snapshot.uniquePositiveTags} uniqueNegTags=${snapshot.uniqueNegativeTags} elapsedMs=${elapsedMs}`,
      );
      yield {
        type: "complete",
        stats: snapshot,
        batchSize: count,
        processedTotal: accumulator.totalImages,
        rootId: batch.rootId,
        isLast: true,
        elapsedMs,
      };
    } else {
      yield {
        type: "batch",
        stats: snapshot,
        batchSize: count,
        processedTotal: accumulator.totalImages,
        rootId: batch.rootId,
        isLast: false,
        elapsedMs,
      };
    }
  }

  // Edge case: empty stream
  if (accumulator.totalImages === 0) {
    console.info(`[streamStats] stream was empty, yielding zero-image stats`);
    yield {
      type: "complete",
      stats: finalizePromptStatistics(accumulator),
      batchSize: 0,
      processedTotal: 0,
      isLast: true,
      elapsedMs: Date.now() - startMs,
    };
  }
}
