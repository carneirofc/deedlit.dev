import {
  extractFromComfyPromptGraph,
  extractPromptTextFromMetadata,
  findFirstValueByKeys,
  getSearchableMetadata,
  parseAutomatic1111Parameters,
  toDisplayValue,
  type PromptMetadataInsights,
} from "@/lib/metadata-parsing";

export type PromptInsights = Pick<
  PromptMetadataInsights,
  "positivePrompt" | "negativePrompt" | "model" | "sampler"
>;

export type ResolvedPromptMetadata = {
  searchableMetadata: unknown;
  parsedParameters: Partial<PromptMetadataInsights>;
  parsedComfy: Partial<PromptMetadataInsights>;
  rawPromptText?: string;
  fallbackPositive?: string;
  fallbackNegative?: string;
  fallbackModel?: string;
  fallbackSampler?: string;
};

export function resolvePromptMetadata(metadata: unknown): ResolvedPromptMetadata {
  const searchableMetadata = getSearchableMetadata(metadata);

  const parametersValue = findFirstValueByKeys(searchableMetadata, ["parameters"]);
  const parametersText = toDisplayValue(parametersValue);
  const parsedParameters = parametersText ? parseAutomatic1111Parameters(parametersText) : {};

  const comfyPromptValue = findFirstValueByKeys(searchableMetadata, ["prompt"]);
  const parsedComfy = extractFromComfyPromptGraph(comfyPromptValue);

  return {
    searchableMetadata,
    parsedParameters,
    parsedComfy,
    rawPromptText: toDisplayValue(comfyPromptValue),
    fallbackPositive: extractPromptTextFromMetadata(searchableMetadata, [
      "positive",
      "positive_prompt",
      "prompt",
      "text",
      "prompt_text",
      "text_g",
      "text_l",
    ]),
    fallbackNegative: extractPromptTextFromMetadata(searchableMetadata, [
      "negative",
      "negative_prompt",
      "negative_text",
      "uc",
      "uncond",
    ]),
    fallbackModel: toDisplayValue(
      findFirstValueByKeys(searchableMetadata, ["model", "model_name", "ckpt_name", "checkpoint"]),
    ),
    fallbackSampler: toDisplayValue(
      findFirstValueByKeys(searchableMetadata, ["sampler", "sampler_name"]),
    ),
  };
}

export function extractPromptInsightsFromMetadata(metadata: unknown): PromptInsights {
  const resolved = resolvePromptMetadata(metadata);

  return {
    positivePrompt:
      resolved.parsedComfy.positivePrompt ?? resolved.parsedParameters.positivePrompt ?? resolved.fallbackPositive,
    negativePrompt:
      resolved.parsedComfy.negativePrompt ?? resolved.parsedParameters.negativePrompt ?? resolved.fallbackNegative,
    model: resolved.parsedComfy.model ?? resolved.parsedParameters.model ?? resolved.fallbackModel,
    sampler: resolved.parsedComfy.sampler ?? resolved.parsedParameters.sampler ?? resolved.fallbackSampler,
  };
}