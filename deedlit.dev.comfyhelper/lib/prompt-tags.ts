export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function normalizePromptToken(value: string): string {
  return normalizeTag(value.replace(/\n/g, " "));
}

export function normalizeExcludedTags(tags: readonly string[]): string[] {
  const normalized = tags.map((entry) => normalizePromptToken(entry)).filter(Boolean);

  return Array.from(new Set(normalized));
}

function isReadonlySet(value: unknown): value is ReadonlySet<string> {
  return typeof value === "object" && value !== null && "has" in value && "forEach" in value;
}

function toExcludedTagSet(exclude?: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  if (!exclude) {
    return new Set<string>();
  }

  if (isReadonlySet(exclude)) {
    return new Set(Array.from(exclude).map((entry) => normalizePromptToken(entry)).filter(Boolean));
  }

  if (Array.isArray(exclude)) {
    return new Set(normalizeExcludedTags(exclude));
  }

  return new Set<string>();
}

export type ExtractTagsFromPromptOptions = {
  exclude?: ReadonlySet<string> | readonly string[];
};

export function extractTagsFromPrompt(
  prompt?: string,
  options?: ExtractTagsFromPromptOptions,
): string[] {
  if (!prompt) {
    return [];
  }

  const excludedTags = toExcludedTagSet(options?.exclude);
  const parts = prompt
    .split(",")
    .map((entry) => normalizePromptToken(entry))
    .filter(Boolean)
    .filter((entry) => !excludedTags.has(entry));

  return Array.from(new Set(parts));
}
