"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "comfyhelper-library-settings";

export type BrowseMode = "browse" | "semantic" | "image";
export type ViewMode = "grid" | "list" | "masonry";
export type GridDensity = "compact" | "comfortable" | "spacious";
export type ImageFit = "contain" | "cover";
/** How browse results are sectioned. `none` = one flat grid; `folder` = split
 *  into collapsible sections by source directory (browse path only). */
export type GroupByMode = "none" | "folder";

/** AI content-safety class. Mirrors the catalog/labelagent `safety` enum. */
export type SafetyClass = "sfw" | "nsfw" | "explicit";
export const SAFETY_CLASSES: readonly SafetyClass[] = ["sfw", "nsfw", "explicit"] as const;
export const SAFETY_LABEL: Record<SafetyClass, string> = {
  sfw: "SFW",
  nsfw: "NSFW",
  explicit: "Explicit",
};

/**
 * Result ordering. `relevance` is the vector-search ranking (only meaningful
 * when there is a text/image query); the rest are server-side catalog sorts used
 * by the filter-only browse grid. Mirrors the catalog `sort` enum + relevance.
 */
export type SortMode =
  | "relevance"
  | "newest"
  | "oldest"
  | "created_desc"
  | "created_asc"
  | "rating_desc"
  | "rating_asc"
  | "name_asc"
  | "name_desc";

export const SORT_MODES: readonly SortMode[] = [
  "relevance",
  "newest",
  "oldest",
  "created_desc",
  "created_asc",
  "rating_desc",
  "rating_asc",
  "name_asc",
  "name_desc",
] as const;

/**
 * User-tunable preferences for the image library UI.  Persisted to
 * localStorage (survives across sessions) and consumed by the browse page,
 * the image viewer, and the suggestion / related-item panels.
 */
export interface LibrarySettings {
  // --- Browsing & pagination ---
  /** Results fetched per page / "load more" step. */
  pageSize: number;
  /** Which search tab the browse page opens on. */
  defaultMode: BrowseMode;
  /** Auto-load the next page when the grid bottom scrolls into view. */
  infiniteScroll: boolean;
  /** How result cards are laid out. */
  viewMode: ViewMode;
  /** Result ordering. Defaults to newest-first for browse; relevance is applied
   * automatically when a text/image query is active. */
  sortMode: SortMode;
  /** Split browse results into collapsible sections by source directory.
   * `none` = one flat grid (default). Only applies on the filter-only browse
   * path; the vector-search results have no directory to group by. */
  groupBy: GroupByMode;
  /** Card size / column count for grid & masonry views. */
  gridDensity: GridDensity;
  /** Show the similarity-score chip on cards. */
  showScores: boolean;
  /** Show summary / model / rating metadata under each card. */
  showCardMeta: boolean;

  // --- Image viewer (detail page) ---
  /** Fit the main viewer image inside its box (contain) or fill it (cover). */
  viewerImageFit: ImageFit;
  /** Load the full-resolution original instead of the thumbnail in the viewer. */
  viewerFullResolution: boolean;
  showPrompt: boolean;
  /** Show the AI-generated description panel on the detail page. */
  showDescription: boolean;
  showGenerationParams: boolean;
  showRelationshipGraph: boolean;
  /** Relationship-graph hop depth (1–3). */
  graphDepth: number;

  // --- Suggestions & related items ---
  showSimilar: boolean;
  /** Number of "similar images" suggestions on the viewer. */
  similarCount: number;
  /** Drop suggestions below this similarity score (0 = keep all). */
  similarMinScore: number;
  /** Fetch suggestions automatically on open vs. on demand. */
  autoLoadSuggestions: boolean;
  showRelatedTags: boolean;
  /** Number of co-occurring tags to surface in the related panel. */
  relatedTagsCount: number;

  // --- Search defaults ---
  defaultMinRating: number;
  defaultFavoritesOnly: boolean;
  /** Default minimum score for semantic / similar / by-image searches. */
  defaultMinScore: number;
  /**
   * Content-safety classes the browse/search grid shows by default. All three
   * (or none) selected = no filter (everything, incl. unclassified); a strict
   * subset hides the unlisted classes. Seeds the library page's safety chips.
   */
  defaultSafety: SafetyClass[];

  // --- Slideshow (fullscreen viewer) ---
  /** Seconds each image is shown before the slideshow auto-advances. */
  slideshowInterval: number;
  /** Loop back to the first image after the last one. */
  slideshowLoop: boolean;
  /** Advance to a random image instead of the next in order. */
  slideshowShuffle: boolean;
}

export const DEFAULT_SETTINGS: LibrarySettings = {
  pageSize: 40,
  defaultMode: "browse",
  infiniteScroll: false,
  viewMode: "grid",
  sortMode: "newest",
  groupBy: "none",
  gridDensity: "comfortable",
  showScores: true,
  showCardMeta: true,

  viewerImageFit: "contain",
  viewerFullResolution: false,
  showPrompt: true,
  showDescription: true,
  showGenerationParams: true,
  showRelationshipGraph: true,
  graphDepth: 1,

  showSimilar: true,
  similarCount: 12,
  similarMinScore: 0,
  autoLoadSuggestions: true,
  showRelatedTags: true,
  relatedTagsCount: 12,

  defaultMinRating: 0,
  defaultFavoritesOnly: false,
  defaultMinScore: 0,
  defaultSafety: ["sfw", "nsfw", "explicit"],

  slideshowInterval: 5,
  slideshowLoop: true,
  slideshowShuffle: false,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Merge a possibly-stale / partial stored blob over the defaults, coercing and
 * clamping each field.  Unknown keys are dropped; missing keys inherit the
 * default, so adding a new setting never breaks an old persisted payload.
 */
function mergeSettings(raw: unknown): LibrarySettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const r = raw as Record<string, unknown>;
  const bool = (k: keyof LibrarySettings): boolean =>
    typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_SETTINGS[k] as boolean);
  const num = (k: keyof LibrarySettings, min: number, max: number): number =>
    typeof r[k] === "number" && Number.isFinite(r[k])
      ? clamp(r[k] as number, min, max)
      : (DEFAULT_SETTINGS[k] as number);
  const oneOf = <T extends string>(k: keyof LibrarySettings, allowed: readonly T[]): T =>
    allowed.includes(r[k] as T) ? (r[k] as T) : (DEFAULT_SETTINGS[k] as unknown as T);
  // Sanitize a stored multi-select against the allowed set (drop junk, de-dupe);
  // a non-array falls back to the default.
  const subsetOf = <T extends string>(k: keyof LibrarySettings, allowed: readonly T[]): T[] => {
    const v = r[k];
    if (!Array.isArray(v)) return [...(DEFAULT_SETTINGS[k] as T[])];
    return Array.from(new Set(v.filter((x): x is T => allowed.includes(x as T))));
  };

  return {
    pageSize: num("pageSize", 10, 200),
    defaultMode: oneOf("defaultMode", ["browse", "semantic", "image"] as const),
    infiniteScroll: bool("infiniteScroll"),
    viewMode: oneOf("viewMode", ["grid", "list", "masonry"] as const),
    sortMode: oneOf("sortMode", SORT_MODES),
    groupBy: oneOf("groupBy", ["none", "folder"] as const),
    gridDensity: oneOf("gridDensity", ["compact", "comfortable", "spacious"] as const),
    showScores: bool("showScores"),
    showCardMeta: bool("showCardMeta"),

    viewerImageFit: oneOf("viewerImageFit", ["contain", "cover"] as const),
    viewerFullResolution: bool("viewerFullResolution"),
    showPrompt: bool("showPrompt"),
    showDescription: bool("showDescription"),
    showGenerationParams: bool("showGenerationParams"),
    showRelationshipGraph: bool("showRelationshipGraph"),
    graphDepth: num("graphDepth", 1, 3),

    showSimilar: bool("showSimilar"),
    similarCount: num("similarCount", 0, 48),
    similarMinScore: num("similarMinScore", 0, 1),
    autoLoadSuggestions: bool("autoLoadSuggestions"),
    showRelatedTags: bool("showRelatedTags"),
    relatedTagsCount: num("relatedTagsCount", 0, 40),

    defaultMinRating: num("defaultMinRating", 0, 5),
    defaultFavoritesOnly: bool("defaultFavoritesOnly"),
    defaultMinScore: num("defaultMinScore", 0, 1),
    defaultSafety: subsetOf("defaultSafety", SAFETY_CLASSES),

    slideshowInterval: num("slideshowInterval", 1, 60),
    slideshowLoop: bool("slideshowLoop"),
    slideshowShuffle: bool("slideshowShuffle"),
  };
}

interface SettingsValue {
  settings: LibrarySettings;
  /** True once the stored payload has been read on the client. */
  hydrated: boolean;
  setKey: <K extends keyof LibrarySettings>(key: K, value: LibrarySettings[K]) => void;
  update: (patch: Partial<LibrarySettings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<LibrarySettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  // Read persisted settings once on the client to avoid a hydration mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSettings(mergeSettings(JSON.parse(raw)));
    } catch {
      // ignore malformed / unavailable storage
    }
    setHydrated(true);
  }, []);

  // Persist after hydration so we never clobber stored values with the defaults
  // written during the initial render.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore quota / disabled storage
    }
  }, [settings, hydrated]);

  const setKey = useCallback(
    <K extends keyof LibrarySettings>(key: K, value: LibrarySettings[K]) =>
      setSettings((prev) => ({ ...prev, [key]: value })),
    [],
  );
  const update = useCallback(
    (patch: Partial<LibrarySettings>) => setSettings((prev) => ({ ...prev, ...patch })),
    [],
  );
  const reset = useCallback(() => setSettings({ ...DEFAULT_SETTINGS }), []);

  const value = useMemo<SettingsValue>(
    () => ({ settings, hydrated, setKey, update, reset }),
    [settings, hydrated, setKey, update, reset],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Layout helpers — shared between the browse page and any view that renders a
// result grid, so density is defined in exactly one place.
// ---------------------------------------------------------------------------

const GRID_COLUMNS: Record<GridDensity, string> = {
  compact:
    "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12 5xl:grid-cols-14",
  comfortable:
    "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 3xl:grid-cols-8 4xl:grid-cols-10 5xl:grid-cols-12",
  spacious:
    "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-8",
};

const MASONRY_COLUMNS: Record<GridDensity, string> = {
  compact: "columns-3 sm:columns-4 lg:columns-6 xl:columns-7 2xl:columns-8 3xl:columns-10 4xl:columns-12 5xl:columns-14",
  comfortable: "columns-2 sm:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 3xl:columns-8 4xl:columns-10 5xl:columns-12",
  spacious: "columns-1 sm:columns-2 lg:columns-3 xl:columns-4 2xl:columns-5 3xl:columns-6 4xl:columns-8",
};

export function gridColumnsClass(density: GridDensity): string {
  return GRID_COLUMNS[density];
}

export function masonryColumnsClass(density: GridDensity): string {
  return MASONRY_COLUMNS[density];
}
