import type { ImageAsset } from "@/features/gallery/types";

export type GallerySort = "created-desc" | "created-asc" | "title-asc" | "title-desc";

export interface GalleryFilterState {
  query: string;
  sort: GallerySort;
}

/**
 * Normalizes a string for case-insensitive comparison.
 * @param value - The string to normalize
 * @returns Trimmed, lowercase string
 */
function normalize(value: string) {
  return value.toLowerCase().trim();
}

/**
 * Performs fuzzy matching to check if a token appears in the haystack.
 * @param token - The search token to find
 * @param haystack - The string to search in
 * @returns True if token matches, false otherwise
 */
function fuzzyTokenMatch(token: string, haystack: string) {
  if (haystack.includes(token)) return true;

  let index = 0;
  for (const char of haystack) {
    if (char === token[index]) {
      index += 1;
      if (index === token.length) return true;
    }
  }

  return false;
}

/**
 * Checks if an image asset matches the search query.
 * Searches across title and ID fields.
 * @param query - The search query string
 * @param asset - The image asset to check
 * @returns True if asset matches query, false otherwise
 */
function matchesQuery(query: string, asset: ImageAsset) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;

  const haystack = normalize(`${asset.title} ${asset.id}`);
  return tokens.every((token) => fuzzyTokenMatch(token, haystack));
}

/**
 * Checks if an event target is a text input element.
 * Used to prevent keyboard shortcuts from firing while typing.
 * @param target - The event target to check
 * @returns True if target is a text input, false otherwise
 */
export function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Applies search and sorting filters to a gallery asset collection.
 * @param assets - Array of image assets to filter and sort
 * @param state - Current filter state with query and sort preferences
 * @returns Filtered and sorted array of image assets
 */
export function applyGalleryFilters(assets: ImageAsset[], state: GalleryFilterState) {
  const filtered = assets.filter((asset) => {
    if (!matchesQuery(state.query, asset)) return false;

    return true;
  });

  return filtered.slice().sort((a, b) => {
    if (state.sort === "title-asc") {
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
    }
    if (state.sort === "title-desc") {
      return b.title.localeCompare(a.title, undefined, { numeric: true, sensitivity: "base" });
    }

    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return 0;

    if (state.sort === "created-asc") return aTime - bTime;
    return bTime - aTime;
  });
}
