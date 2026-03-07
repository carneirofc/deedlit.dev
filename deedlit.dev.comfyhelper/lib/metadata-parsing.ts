export type PromptMetadataInsights = {
  positivePrompt?: string;
  negativePrompt?: string;
  model?: string;
  sampler?: string;
  cfgScale?: string;
  steps?: string;
  seed?: string;
  scheduler?: string;
  size?: string;
};

const metadataSearchCache = new WeakMap<object, Map<string, unknown>>();

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getCacheKey(keys: string[]): string {
  return keys.map((key) => normalizeKey(key)).join("|");
}

export function maybeParseJsonString(value: unknown): unknown {
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

export function toDisplayValue(value: unknown): string | undefined {
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

export function getSearchableMetadata(metadata: unknown): unknown {
  return isRecord(metadata) && isRecord(metadata.fields) ? metadata.fields : metadata;
}

export function findFirstValueByKeys(root: unknown, keys: string[]): unknown {
  if (!root) {
    return undefined;
  }

  if (isRecord(root)) {
    const cache = metadataSearchCache.get(root);
    const cacheKey = getCacheKey(keys);
    if (cache?.has(cacheKey)) {
      return cache.get(cacheKey);
    }
  }

  const keySet = new Set(keys.map((key) => normalizeKey(key)));
  const seen = new WeakSet<object>();

  const visit = (value: unknown): unknown => {
    const parsed = maybeParseJsonString(value);

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const found = visit(item);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    }

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

  const result = visit(root);

  if (isRecord(root)) {
    const cacheKey = getCacheKey(keys);
    const cache = metadataSearchCache.get(root) ?? new Map<string, unknown>();
    cache.set(cacheKey, result);
    metadataSearchCache.set(root, cache);
  }

  return result;
}

export function extractPromptTextFromMetadata(metadata: unknown, keys: string[]): string | undefined {
  return toDisplayValue(findFirstValueByKeys(metadata, keys));
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

  const parts = [
    toDisplayValue(node.inputs.text),
    toDisplayValue(node.inputs.text_g),
    toDisplayValue(node.inputs.text_l),
  ].filter((value): value is string => Boolean(value));

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join("\n");
}

export function extractFromComfyPromptGraph(promptValue: unknown): Partial<PromptMetadataInsights> {
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

  let kSamplerEntry: [string, { classType?: string; inputs?: Record<string, unknown> }] | undefined;
  let loaderNode: { classType?: string; inputs?: Record<string, unknown> } | undefined;

  for (const [nodeId, node] of Object.entries(nodes)) {
    const classType = (node.classType ?? "").toLowerCase();

    if (!kSamplerEntry && classType.includes("ksampler")) {
      kSamplerEntry = [nodeId, node];
    }

    if (!loaderNode && (classType.includes("checkpointloader") || classType.includes("unetloader"))) {
      loaderNode = node;
    }

    if (kSamplerEntry && loaderNode) {
      break;
    }
  }

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

  if (!modelName && !loaderNode) {
    loaderNode = Object.values(nodes).find((node) => {
      const classType = (node.classType ?? "").toLowerCase();
      return classType.includes("checkpointloader") || classType.includes("unetloader");
    });
  }

  if (!modelName && loaderNode?.inputs) {
    modelName =
      toDisplayValue(loaderNode.inputs.ckpt_name) ??
      toDisplayValue(loaderNode.inputs.model_name) ??
      toDisplayValue(loaderNode.inputs.unet_name);
  }

  return {
    positivePrompt: extractTextFromPromptNode(positiveRef, nodes),
    negativePrompt: extractTextFromPromptNode(negativeRef, nodes),
    model: modelName,
    sampler: toDisplayValue(inputs.sampler_name),
    cfgScale: toDisplayValue(inputs.cfg),
    steps: toDisplayValue(inputs.steps),
    seed: toDisplayValue(inputs.seed),
    scheduler: toDisplayValue(inputs.scheduler),
  };
}

type ParseAutomatic1111ParametersOptions = {
  includeFirstLineAsPositive?: boolean;
};

export function parseAutomatic1111Parameters(
  parameters: string,
  options: ParseAutomatic1111ParametersOptions = {},
): Partial<PromptMetadataInsights> {
  const result: Partial<PromptMetadataInsights> = {};
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
  } else if (options.includeFirstLineAsPositive) {
    const firstLine = text.split("\n")[0]?.trim();
    if (firstLine) {
      result.positivePrompt = firstLine;
    }
  }

  const capture = (pattern: RegExp): string | undefined => text.match(pattern)?.[1]?.trim();

  result.steps = capture(/Steps:\s*([^,\n]+)/i);
  result.sampler = capture(/Sampler:\s*([^,\n]+)/i);
  result.cfgScale = capture(/CFG scale:\s*([^,\n]+)/i);
  result.seed = capture(/Seed:\s*([^,\n]+)/i);
  result.size = capture(/Size:\s*([^,\n]+)/i);
  result.model = capture(/Model:\s*([^,\n]+)/i);

  return result;
}