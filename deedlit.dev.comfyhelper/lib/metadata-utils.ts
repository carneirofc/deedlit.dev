import type { ImageRecord } from "./library-types";
import type {
  GenerationDetails,
  WorkflowDetails,
  WorkflowEdge,
  WorkflowInputEntry,
  WorkflowNodeEntry,
  WorkflowNodePalette,
} from "./gallery-types";

// Cache for metadata searches to avoid repeated recursive lookups
const metadataSearchCache = new WeakMap<object, Map<string, unknown>>();


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

function toInlineValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function findFirstValueByKeys(root: unknown, keys: string[]): unknown {
  // Check cache first to avoid repeated recursive searches
  if (isRecord(root) && metadataSearchCache.has(root)) {
    const cache = metadataSearchCache.get(root)!;
    const cacheKey = keys.join("|");
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
  }

  const keySet = new Set(keys.map((key) => normalizeKey(key)));
  const seen = new WeakSet<object>();

  function visit(value: unknown): unknown {
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
  }

  const result = visit(root);

  // Cache the result for future lookups
  if (isRecord(root)) {
    if (!metadataSearchCache.has(root)) {
      metadataSearchCache.set(root, new Map());
    }
    metadataSearchCache.get(root)!.set(keys.join("|"), result);
  }

  return result;
}

function extractPromptTextFromMetadata(metadata: unknown, keys: string[]): string | undefined {
  const value = findFirstValueByKeys(metadata, keys);
  const text = toDisplayValue(value);
  if (text) {
    return text;
  }

  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  return undefined;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function parseNodePosition(value: unknown): { x: number; y: number } {
  if (Array.isArray(value) && value.length >= 2) {
    return {
      x: toFiniteNumber(value[0], 0),
      y: toFiniteNumber(value[1], 0),
    };
  }

  if (isRecord(value)) {
    return {
      x: toFiniteNumber(value.x, 0),
      y: toFiniteNumber(value.y, 0),
    };
  }

  return { x: 0, y: 0 };
}

function parseNodeSize(value: unknown): { width: number; height: number } {
  const clampWidth = (input: number) => Math.min(360, Math.max(180, input));
  const clampHeight = (input: number) => Math.min(260, Math.max(88, input));

  if (Array.isArray(value) && value.length >= 2) {
    return {
      width: clampWidth(toFiniteNumber(value[0], 260)),
      height: clampHeight(toFiniteNumber(value[1], 120)),
    };
  }

  if (isRecord(value)) {
    return {
      width: clampWidth(toFiniteNumber(value.width, 260)),
      height: clampHeight(toFiniteNumber(value.height, 120)),
    };
  }

  return { width: 260, height: 120 };
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
  nodes: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>,
): string | undefined {
  if (!nodeId) {
    return undefined;
  }

  const node = nodes[nodeId];
  if (!node?.inputs) {
    return undefined;
  }

  const textParts = [
    toDisplayValue(node.inputs.text),
    toDisplayValue(node.inputs.text_g),
    toDisplayValue(node.inputs.text_l),
  ].filter((value): value is string => Boolean(value));

  if (textParts.length === 0) {
    return undefined;
  }

  return textParts.join("\n");
}

function extractFromComfyPromptGraph(promptValue: unknown): Partial<GenerationDetails> {
  const parsedPrompt = maybeParseJsonString(promptValue);
  if (!isRecord(parsedPrompt)) {
    return {};
  }

  const nodes: Record<string, { class_type?: string; inputs?: Record<string, unknown> }> = {};

  // Parse nodes once
  for (const [nodeId, nodeValue] of Object.entries(parsedPrompt)) {
    if (!isRecord(nodeValue)) {
      continue;
    }

    const classType = toDisplayValue(nodeValue.class_type);
    const inputs = isRecord(nodeValue.inputs) ? nodeValue.inputs : undefined;
    if (!classType || !inputs) {
      continue;
    }

    nodes[nodeId] = {
      class_type: classType,
      inputs,
    };
  }

  // Single pass: find both kSampler and loader with early exit optimization
  let kSamplerEntry: [string, { class_type?: string; inputs?: Record<string, unknown> }] | undefined;
  let loaderNode: { class_type?: string; inputs?: Record<string, unknown> } | undefined;

  for (const [nodeId, node] of Object.entries(nodes)) {
    const classType = (node.class_type ?? "").toLowerCase();

    if (!kSamplerEntry && classType.includes("ksampler")) {
      kSamplerEntry = [nodeId, node];
    }

    if (!loaderNode && (classType.includes("checkpointloader") || classType.includes("unetloader"))) {
      loaderNode = node;
    }

    // Early exit if we found both
    if (kSamplerEntry && loaderNode) {
      break;
    }
  }

  if (!kSamplerEntry) {
    return {};
  }

  const [, kSamplerNode] = kSamplerEntry;
  const inputs = kSamplerNode.inputs ?? {};

  const positiveRef = resolveNodeReference(inputs.positive);
  const negativeRef = resolveNodeReference(inputs.negative);
  const modelRef = resolveNodeReference(inputs.model);

  let modelName = undefined as string | undefined;
  if (modelRef && nodes[modelRef]?.inputs) {
    const modelInputs = nodes[modelRef].inputs ?? {};
    modelName =
      toDisplayValue(modelInputs.ckpt_name) ??
      toDisplayValue(modelInputs.model_name) ??
      toDisplayValue(modelInputs.unet_name);
  }

  // Only search for loader if we don't have model name and haven't found loader yet
  if (!modelName && !loaderNode) {
    loaderNode = Object.values(nodes).find((node) => {
      const classType = (node.class_type ?? "").toLowerCase();
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
    cfgScale: toDisplayValue(inputs.cfg),
    steps: toDisplayValue(inputs.steps),
    seed: toDisplayValue(inputs.seed),
    sampler: toDisplayValue(inputs.sampler_name),
    scheduler: toDisplayValue(inputs.scheduler),
    model: modelName,
  };
}

function parseAutomatic1111Parameters(parameters: string): Partial<GenerationDetails> {
  const result: Partial<GenerationDetails> = {};
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
    if (settingsStart >= 0) {
      const negativePart = afterNegative.slice(0, settingsStart).trim();
      if (negativePart) {
        result.negativePrompt = negativePart;
      }
    } else {
      const negativePart = afterNegative.trim();
      if (negativePart) {
        result.negativePrompt = negativePart;
      }
    }
  } else {
    const firstLine = text.split("\n")[0]?.trim();
    if (firstLine) {
      result.positivePrompt = firstLine;
    }
  }

  const capture = (pattern: RegExp): string | undefined => {
    const match = text.match(pattern);
    return match?.[1]?.trim();
  };

  result.steps = capture(/Steps:\s*([^,\n]+)/i);
  result.sampler = capture(/Sampler:\s*([^,\n]+)/i);
  result.cfgScale = capture(/CFG scale:\s*([^,\n]+)/i);
  result.seed = capture(/Seed:\s*([^,\n]+)/i);
  result.size = capture(/Size:\s*([^,\n]+)/i);
  result.model = capture(/Model:\s*([^,\n]+)/i);

  return result;
}

export function buildGenerationDetails(image: ImageRecord): GenerationDetails {
  const metadata = image.metadata;
  const promptSummary = image.promptSummary;
  const searchableMetadata =
    isRecord(metadata) && isRecord(metadata.fields) ? metadata.fields : metadata;

  const parametersValue = findFirstValueByKeys(searchableMetadata, ["parameters"]);
  const parametersText = toDisplayValue(parametersValue);
  const parsedParameters = parametersText ? parseAutomatic1111Parameters(parametersText) : {};

  const comfyPromptValue = findFirstValueByKeys(searchableMetadata, ["prompt"]);
  const parsedComfy = extractFromComfyPromptGraph(comfyPromptValue);
  const rawPromptText = toDisplayValue(comfyPromptValue);

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
  const fallbackCfg = toDisplayValue(
    findFirstValueByKeys(searchableMetadata, ["cfg_scale", "cfg"]),
  );
  const fallbackSampler = toDisplayValue(
    findFirstValueByKeys(searchableMetadata, ["sampler", "sampler_name"]),
  );
  const fallbackSummaryPositive = toDisplayValue(promptSummary?.positivePrompt);
  const fallbackSummaryNegative = toDisplayValue(promptSummary?.negativePrompt);
  const fallbackSummaryModel = toDisplayValue(promptSummary?.model);
  const fallbackSummarySampler = toDisplayValue(promptSummary?.sampler);
  const fallbackSteps = toDisplayValue(findFirstValueByKeys(searchableMetadata, ["steps"]));
  const fallbackSeed = toDisplayValue(findFirstValueByKeys(searchableMetadata, ["seed"]));

  const sizeValue = toDisplayValue(findFirstValueByKeys(searchableMetadata, ["size"]));
  const widthValue = toDisplayValue(findFirstValueByKeys(searchableMetadata, ["width"]));
  const heightValue = toDisplayValue(findFirstValueByKeys(searchableMetadata, ["height"]));
  const combinedSize =
    sizeValue ?? (widthValue && heightValue ? `${widthValue}x${heightValue}` : undefined);

  const additionalCandidates = [
    { label: "Scheduler", keys: ["scheduler"] },
    { label: "Denoise", keys: ["denoise", "denoise_strength"] },
    { label: "Clip Skip", keys: ["clip_skip"] },
    { label: "Batch Size", keys: ["batch_size", "batch"] },
  ];

  const additional = additionalCandidates
    .map((candidate) => {
      const value = toDisplayValue(findFirstValueByKeys(searchableMetadata, candidate.keys));
      if (!value) {
        return null;
      }

      return {
        label: candidate.label,
        value,
      };
    })
    .filter((entry): entry is { label: string; value: string } => Boolean(entry));

  return {
    positivePrompt:
      parsedComfy.positivePrompt ??
      parsedParameters.positivePrompt ??
      rawPromptText ??
      fallbackSummaryPositive ??
      fallbackPositive ??
      undefined,
    negativePrompt:
      parsedComfy.negativePrompt ??
      parsedParameters.negativePrompt ??
      fallbackSummaryNegative ??
      fallbackNegative ??
      undefined,
    model: parsedComfy.model ?? parsedParameters.model ?? fallbackModel ?? fallbackSummaryModel,
    sampler: parsedComfy.sampler ?? parsedParameters.sampler ?? fallbackSampler ?? fallbackSummarySampler,
    scheduler: parsedComfy.scheduler ?? undefined,
    cfgScale: parsedComfy.cfgScale ?? parsedParameters.cfgScale ?? fallbackCfg,
    steps: parsedComfy.steps ?? parsedParameters.steps ?? fallbackSteps,
    seed: parsedComfy.seed ?? parsedParameters.seed ?? fallbackSeed,
    size: parsedParameters.size ?? combinedSize,
    metadataSource:
      isRecord(metadata) && typeof metadata.source === "string" ? metadata.source : undefined,
    additional,
  };
}

export function extractWorkflowDetails(metadata: unknown): WorkflowDetails | null {
  const searchableMetadata =
    isRecord(metadata) && isRecord(metadata.fields) ? metadata.fields : metadata;
  const workflowValue = findFirstValueByKeys(searchableMetadata, ["workflow"]);
  const workflow = maybeParseJsonString(workflowValue);

  if (!isRecord(workflow) || !Array.isArray(workflow.nodes)) {
    return null;
  }

  const workflowId = toDisplayValue(workflow.id);
  const nodes: WorkflowNodeEntry[] = [];
  const sourceByLinkId = new Map<string, { nodeId: string; outputIndex: number }>();
  const pendingTargets: Array<{
    toNodeId: string;
    toInputName: string;
    toInputIndex: number;
    linkId: string;
  }> = [];

  for (const [index, nodeValue] of workflow.nodes.entries()) {
    if (!isRecord(nodeValue)) {
      continue;
    }

    const nodeType = toDisplayValue(nodeValue.type) ?? "Unknown";
    const nodeTitle = toDisplayValue(nodeValue.title) ?? nodeType;
    const nodeId = toInlineValue(nodeValue.id) ?? `node-${index + 1}`;
    const widgetValues = Array.isArray(nodeValue.widgets_values) ? nodeValue.widgets_values : [];
    const position = parseNodePosition(nodeValue.pos);
    const size = parseNodeSize(nodeValue.size);

    let noteText: string | undefined;
    if (nodeType.toLowerCase() === "note" || nodeTitle.toLowerCase().includes("note")) {
      noteText = widgetValues
        .map((value) => toInlineValue(value))
        .find((value): value is string => Boolean(value));
    }

    const inputs: WorkflowInputEntry[] = [];
    if (Array.isArray(nodeValue.inputs)) {
      for (const [inputIndex, inputValue] of nodeValue.inputs.entries()) {
        if (!isRecord(inputValue)) {
          continue;
        }

        const inputName = toDisplayValue(inputValue.name) ?? `input_${inputIndex + 1}`;
        const inputType = toDisplayValue(inputValue.type);
        const widgetName =
          isRecord(inputValue.widget) ? toDisplayValue(inputValue.widget.name) : undefined;
        const linkValue = toInlineValue(inputValue.link);
        const rawValue =
          toInlineValue((inputValue as Record<string, unknown>).value) ??
          (linkValue ? `link:${linkValue}` : undefined);

        const displayName =
          widgetName && widgetName !== inputName ? `${inputName} (${widgetName})` : inputName;

        inputs.push({
          index: inputIndex,
          name: displayName,
          type: inputType,
          value: rawValue,
        });

        if (linkValue) {
          pendingTargets.push({
            toNodeId: nodeId,
            toInputName: displayName,
            toInputIndex: inputIndex,
            linkId: linkValue,
          });
        }
      }
    }

    let outputCount = 0;
    if (Array.isArray(nodeValue.outputs)) {
      for (const [outputIndex, outputValue] of nodeValue.outputs.entries()) {
        if (!isRecord(outputValue) || !Array.isArray(outputValue.links)) {
          continue;
        }

        outputCount += 1;
        for (const linkValue of outputValue.links) {
          const linkId = toInlineValue(linkValue);
          if (!linkId) {
            continue;
          }
          sourceByLinkId.set(linkId, { nodeId, outputIndex });
        }
      }
    }

    for (const [widgetIndex, widgetValue] of widgetValues.entries()) {
      const widgetText = toInlineValue(widgetValue);
      if (!widgetText) {
        continue;
      }

      inputs.push({
        index: inputs.length,
        name: `widget_${widgetIndex + 1}`,
        value: widgetText,
      });
    }

    const searchParts = [
      nodeId,
      nodeTitle,
      nodeType,
      noteText ?? "",
      ...inputs.map((entry) => `${entry.name} ${entry.type ?? ""} ${entry.value ?? ""}`),
    ];

    const ioCount = Math.max(inputs.length, outputCount, noteText ? 2 : 1);
    const visualHeight = Math.max(size.height, 56 + ioCount * 16);

    nodes.push({
      id: nodeId,
      title: nodeTitle,
      type: nodeType,
      note: noteText,
      inputs,
      searchText: searchParts.join(" ").toLowerCase(),
      x: position.x,
      y: position.y,
      width: size.width,
      height: visualHeight,
      outputCount,
    });
  }

  nodes.sort((a, b) => {
    const aNumber = Number.parseInt(a.id, 10);
    const bNumber = Number.parseInt(b.id, 10);
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
      return aNumber - bNumber;
    }
    return a.id.localeCompare(b.id);
  });

  const edges: WorkflowEdge[] = [];
  for (const [index, target] of pendingTargets.entries()) {
    const source = sourceByLinkId.get(target.linkId);
    if (!source) {
      continue;
    }

    edges.push({
      id: `${target.linkId}-${index}`,
      fromNodeId: source.nodeId,
      toNodeId: target.toNodeId,
      toInputName: target.toInputName,
      fromOutputIndex: source.outputIndex,
      toInputIndex: target.toInputIndex,
    });
  }

  const minX = nodes.reduce((current, node) => Math.min(current, node.x), 0);
  const minY = nodes.reduce((current, node) => Math.min(current, node.y), 0);
  const maxX = nodes.reduce((current, node) => Math.max(current, node.x + node.width), 0);
  const maxY = nodes.reduce((current, node) => Math.max(current, node.y + node.height), 0);

  return {
    workflowId,
    nodes,
    edges,
    noteNodeCount: nodes.filter((node) => Boolean(node.note)).length,
    minX,
    minY,
    maxX,
    maxY,
  };
}

export function getWorkflowNodePalette(nodeType: string): WorkflowNodePalette {
  const palettes: WorkflowNodePalette[] = [
    {
      bg: "var(--workflow-palette-1-bg)",
      border: "var(--workflow-palette-1-border)",
      text: "var(--workflow-palette-1-text)",
      edge: "var(--workflow-palette-1-edge)",
      selectedBg: "var(--workflow-palette-1-selected-bg)",
      selectedBorder: "var(--workflow-palette-1-selected-border)",
    },
    {
      bg: "var(--workflow-palette-2-bg)",
      border: "var(--workflow-palette-2-border)",
      text: "var(--workflow-palette-2-text)",
      edge: "var(--workflow-palette-2-edge)",
      selectedBg: "var(--workflow-palette-2-selected-bg)",
      selectedBorder: "var(--workflow-palette-2-selected-border)",
    },
    {
      bg: "var(--workflow-palette-3-bg)",
      border: "var(--workflow-palette-3-border)",
      text: "var(--workflow-palette-3-text)",
      edge: "var(--workflow-palette-3-edge)",
      selectedBg: "var(--workflow-palette-3-selected-bg)",
      selectedBorder: "var(--workflow-palette-3-selected-border)",
    },
    {
      bg: "var(--workflow-palette-4-bg)",
      border: "var(--workflow-palette-4-border)",
      text: "var(--workflow-palette-4-text)",
      edge: "var(--workflow-palette-4-edge)",
      selectedBg: "var(--workflow-palette-4-selected-bg)",
      selectedBorder: "var(--workflow-palette-4-selected-border)",
    },
    {
      bg: "var(--workflow-palette-5-bg)",
      border: "var(--workflow-palette-5-border)",
      text: "var(--workflow-palette-5-text)",
      edge: "var(--workflow-palette-5-edge)",
      selectedBg: "var(--workflow-palette-5-selected-bg)",
      selectedBorder: "var(--workflow-palette-5-selected-border)",
    },
    {
      bg: "var(--workflow-palette-6-bg)",
      border: "var(--workflow-palette-6-border)",
      text: "var(--workflow-palette-6-text)",
      edge: "var(--workflow-palette-6-edge)",
      selectedBg: "var(--workflow-palette-6-selected-bg)",
      selectedBorder: "var(--workflow-palette-6-selected-border)",
    },
  ];

  const normalized = nodeType.toLowerCase().replace(/[^a-z0-9]/g, "");
  let hash = 0;
  for (const char of normalized) {
    hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  }

  return palettes[hash % palettes.length];
}
