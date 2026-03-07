import type { ImageRecord } from "./library-types";
import { resolvePromptMetadata } from "./metadata-insights";
import {
  findFirstValueByKeys,
  getSearchableMetadata,
  isRecord,
  maybeParseJsonString,
  parseAutomatic1111Parameters,
  toDisplayValue,
} from "./metadata-parsing";
import type {
  GenerationDetails,
  WorkflowDetails,
  WorkflowEdge,
  WorkflowInputEntry,
  WorkflowNodeEntry,
  WorkflowNodePalette,
} from "./gallery-types";

const ADDITIONAL_GENERATION_DETAIL_CANDIDATES: Array<{ label: string; keys: string[] }> = [
  { label: "Scheduler", keys: ["scheduler"] },
  { label: "Denoise", keys: ["denoise", "denoise_strength"] },
  { label: "Clip Skip", keys: ["clip_skip"] },
  { label: "Batch Size", keys: ["batch_size", "batch"] },
];

function toInlineValue(value: unknown): string | undefined {
  return toDisplayValue(value);
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

export function buildGenerationDetails(image: ImageRecord): GenerationDetails {
  const metadata = image.metadata;
  const promptSummary = image.promptSummary;
  const resolvedPromptMetadata = resolvePromptMetadata(metadata);
  const searchableMetadata = resolvedPromptMetadata.searchableMetadata;
  const parametersValue = findFirstValueByKeys(searchableMetadata, ["parameters"]);
  const parametersText = toDisplayValue(parametersValue);
  const parsedParameters = parametersText
    ? parseAutomatic1111Parameters(parametersText, { includeFirstLineAsPositive: true })
    : {};
  const parsedComfy = resolvedPromptMetadata.parsedComfy;
  const rawPromptText = resolvedPromptMetadata.rawPromptText;
  const fallbackPositive = resolvedPromptMetadata.fallbackPositive;
  const fallbackNegative = resolvedPromptMetadata.fallbackNegative;
  const fallbackModel = resolvedPromptMetadata.fallbackModel;
  const fallbackSampler = resolvedPromptMetadata.fallbackSampler;
  const fallbackCfg = toDisplayValue(findFirstValueByKeys(searchableMetadata, ["cfg_scale", "cfg"]));
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

  const additional = ADDITIONAL_GENERATION_DETAIL_CANDIDATES
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
  const searchableMetadata = getSearchableMetadata(metadata);
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
