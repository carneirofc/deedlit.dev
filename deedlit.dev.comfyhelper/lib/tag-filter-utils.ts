import type { TagCount } from "./gallery-types";

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function normalizePresetName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizePresetTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => normalizeTag(tag)).filter(Boolean)));
}

export function parsePresetTagDraft(value: string): string[] {
  return normalizePresetTags(
    value
      .split(/[\r\n,;]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function buildTagCounts(tags: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tag of tags) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

export function sortTagCounts(counts: Map<string, number>): TagCount[] {
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
