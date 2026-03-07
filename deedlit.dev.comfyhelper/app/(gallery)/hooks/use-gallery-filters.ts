"use client";

import { type Dispatch, type SetStateAction, useCallback, useDeferredValue, useMemo, useState } from "react";

import type { ImageRecord, RootDirectory, TagFilterPreset } from "@/lib/library-types";
import { toggleStringInList } from "@/lib/list-utils";
import type { GenerationDetails, PathTreeNode, TagCount } from "@/lib/gallery-types";
import { extractTagsFromPrompt, normalizeTag, normalizeExcludedTags } from "@/lib/prompt-tags";
import {
  normalizePathKey,
  getDirectoryPath,
  isWithinPathPrefix,
  getDeepestNodes,
  buildPathTree,
} from "@/lib/path-tree-utils";
import {
  buildTagCounts,
  sortTagCounts,
} from "@/lib/tag-filter-utils";

const IMAGE_BATCH_SIZE = 60;
const MAX_WINDOW_SIZE = 5 * IMAGE_BATCH_SIZE; // max rendered images (sliding window)

type EnrichedImage = {
  image: ImageRecord;
  details: GenerationDetails;
  positiveTags: string[];
  positiveTagSet: Set<string>;
  negativeTags: string[];
  negativeTagSet: Set<string>;
  model: string;
  modelLabel: string;
};

type TagLogicalMode = "and" | "or";
type SortOrder = "newest" | "oldest" | "none";

type EnrichmentCacheEntry = {
  enriched: EnrichedImage;
  /** Cache key: a fingerprint of the data used to enrich */
  fingerprint: string;
};

const ENRICHMENT_CACHE_LIMIT = 8000;
const enrichmentCache = new Map<string, EnrichmentCacheEntry>();

function sanitizeSelectedFilterValues(
  values: readonly string[],
  options?: {
    normalize?: boolean;
    exclude?: ReadonlySet<string>;
  },
): string[] {
  const shouldNormalize = options?.normalize ?? true;
  const exclude = options?.exclude;
  const sanitized = values
    .map((value) => (shouldNormalize ? normalizeTag(value) : value.trim()))
    .filter(Boolean)
    .filter((value) => !exclude?.has(value));

  return Array.from(new Set(sanitized));
}

function matchesTagFilter(tagSet: ReadonlySet<string>, selectedTags: readonly string[], mode: TagLogicalMode): boolean {
  if (selectedTags.length === 0) return true;
  return mode === "and"
    ? selectedTags.every((tag) => tagSet.has(tag))
    : selectedTags.some((tag) => tagSet.has(tag));
}

function includesAnyTag(tags: readonly string[], exclusions: ReadonlySet<string>): boolean {
  if (exclusions.size === 0) return false;
  return tags.some((tag) => exclusions.has(tag));
}

function matchesModelFilter(model: string, selectedModels: ReadonlySet<string>): boolean {
  if (selectedModels.size === 0) return true;
  return Boolean(model) && selectedModels.has(model);
}

export type GalleryFiltersState = {
  // Filter state
  selectedRootId: string;
  setSelectedRootId: (id: string) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedPathNode: string | null;
  setSelectedPathNode: (node: string | null) => void;
  selectedPositiveTags: string[];
  setSelectedPositiveTags: Dispatch<SetStateAction<string[]>>;
  selectedNegativeTags: string[];
  setSelectedNegativeTags: Dispatch<SetStateAction<string[]>>;
  selectedModels: string[];
  setSelectedModels: Dispatch<SetStateAction<string[]>>;
  tagLogicalMode: TagLogicalMode;
  setTagLogicalMode: Dispatch<SetStateAction<TagLogicalMode>>;
  sortOrder: SortOrder;
  setSortOrder: Dispatch<SetStateAction<SortOrder>>;
  showOnlyUntagged: boolean;
  setShowOnlyUntagged: Dispatch<SetStateAction<boolean>>;

  // Derived data
  enrichedImages: EnrichedImage[];
  filteredImages: ImageRecord[];
  visibleImages: ImageRecord[];
  visibleImageCount: number;
  windowStart: number;
  windowEnd: number;
  canShowMoreImages: boolean;
  canShowPreviousImages: boolean;
  slideWindowDown: () => void;
  slideWindowUp: () => void;
  excludedTagSet: Set<string>;
  detailsById: Map<string, GenerationDetails>;

  // Path tree
  pathTree: PathTreeNode[];
  pathTreeIndex: Map<string, PathTreeNode>;
  currentPathTreeNodes: PathTreeNode[];
  deepestPathTreeNodes: PathTreeNode[];
  selectedPathBreadcrumb: PathTreeNode[];
  deepestSelectedPath: PathTreeNode | null;

  // Tag counts
  positiveTagCounts: TagCount[];
  negativeTagCounts: TagCount[];
  modelCounts: TagCount[];

  // Helpers
  toggleTagSelection: (tag: string, setSelected: Dispatch<SetStateAction<string[]>>) => void;
  showMoreImages: () => void;
  clearAllFilters: () => void;
};

export function useGalleryFilters(
  images: ImageRecord[],
  roots: RootDirectory[],
  excludedTags: string[],
  activeTagFilterPreset: TagFilterPreset | null,
): GalleryFiltersState {
  const [selectedRootIdState, setSelectedRootId] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPathNodeState, setSelectedPathNode] = useState<string | null>(null);
  const [selectedPositiveTagsState, setSelectedPositiveTagsState] = useState<string[]>([]);
  const [selectedNegativeTagsState, setSelectedNegativeTagsState] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [tagLogicalMode, setTagLogicalMode] = useState<TagLogicalMode>("and");
  const [sortOrder, setSortOrder] = useState<SortOrder>("none");
  const [showOnlyUntagged, setShowOnlyUntagged] = useState(false);
  const [windowState, setWindowState] = useState(() => ({
    start: 0,
    end: IMAGE_BATCH_SIZE,
    signature: "init",
  }));
  const deferredSearchTerm = useDeferredValue(searchTerm);

  // Pre-normalize excluded tags so extractTagsFromPrompt doesn't re-normalize per call
  const excludedTagSet = useMemo(() => new Set(normalizeExcludedTags(excludedTags)), [excludedTags]);

  const selectedRootId = useMemo(() => {
    if (selectedRootIdState === "all") return "all";
    return roots.some((root) => root.id === selectedRootIdState) ? selectedRootIdState : "all";
  }, [roots, selectedRootIdState]);

  const selectedPositiveTags = useMemo(() => {
    return sanitizeSelectedFilterValues(selectedPositiveTagsState, {
      exclude: excludedTagSet,
    });
  }, [selectedPositiveTagsState, excludedTagSet]);

  const selectedNegativeTags = useMemo(() => {
    return sanitizeSelectedFilterValues(selectedNegativeTagsState, {
      exclude: excludedTagSet,
    });
  }, [selectedNegativeTagsState, excludedTagSet]);

  const selectedModelTags = useMemo(() => {
    return sanitizeSelectedFilterValues(selectedModels);
  }, [selectedModels]);

  const selectedModelTagSet = useMemo(() => {
    return new Set(selectedModelTags);
  }, [selectedModelTags]);

  // ── Root-filtered images ──────────────────────────────────────────

  const rootFilteredImages = useMemo(() => {
    const scopedImages = images.filter((image) => selectedRootId === "all" || image.rootId === selectedRootId);
    const uniqueByAbsolutePath = new Map<string, ImageRecord>();

    // Overlapping roots can surface the same file multiple times with different IDs.
    // Keep one entry per absolute path so single-image actions don't fan out unexpectedly in the UI.
    for (const image of scopedImages) {
      const existing = uniqueByAbsolutePath.get(image.absolutePath);
      if (!existing) {
        uniqueByAbsolutePath.set(image.absolutePath, image);
        continue;
      }

      // Prefer the shortest relative path when duplicates refer to the same file.
      if (image.relativePath.length < existing.relativePath.length) {
        uniqueByAbsolutePath.set(image.absolutePath, image);
      }
    }

    return Array.from(uniqueByAbsolutePath.values());
  }, [images, selectedRootId]);

  // ── Enriched images (tags + model extracted) ──────────────────────
  // Incremental enrichment: reuse cached enrichment for images whose prompt
  // data hasn't changed. Only re-enrich new or modified images. This avoids
  // calling extractTagsFromPrompt for ALL images when SSE patches arrive.

  const enrichedImages = useMemo(() => {
    const result: EnrichedImage[] = [];

    // Stringify excludedTagSet once for the fingerprint
    // Use a sorted representation so the fingerprint is stable
    const excludedTagsKey = [...excludedTagSet].sort().join("|");

    for (const image of rootFilteredImages) {
      // Build a cheap fingerprint from the data that affects enrichment
      const promptPos = image.promptSummary?.positivePrompt ?? image.generationDetails?.positivePrompt ?? "";
      const promptNeg = image.promptSummary?.negativePrompt ?? image.generationDetails?.negativePrompt ?? "";
      const modelStr = image.promptSummary?.model ?? image.generationDetails?.model ?? "";
      const fingerprint = `${promptPos.length}:${promptNeg.length}:${modelStr}:${excludedTagsKey}`;

      const cached = enrichmentCache.get(image.id);
      if (cached && cached.fingerprint === fingerprint) {
        // Reuse cached enrichment, but update the image reference in case it changed
        const reused = cached.enriched.image === image
          ? cached.enriched
          : { ...cached.enriched, image };
        enrichmentCache.set(image.id, { enriched: reused, fingerprint });
        result.push(reused);
        continue;
      }

      // Enrich from scratch
      const details = image.generationDetails ?? {
        positivePrompt: image.promptSummary?.positivePrompt,
        negativePrompt: image.promptSummary?.negativePrompt,
        model: image.promptSummary?.model,
        sampler: image.promptSummary?.sampler,
        additional: [],
      };
      const positiveTags = extractTagsFromPrompt(details.positivePrompt, { exclude: excludedTagSet });
      const negativeTags = extractTagsFromPrompt(details.negativePrompt, { exclude: excludedTagSet });
      const model = details.model?.trim() ?? "";

      const enriched: EnrichedImage = {
        image,
        details,
        positiveTags,
        positiveTagSet: new Set(positiveTags),
        negativeTags,
        negativeTagSet: new Set(negativeTags),
        model: model ? normalizeTag(model) : "",
        modelLabel: model,
      };

      enrichmentCache.set(image.id, { enriched, fingerprint });
      result.push(enriched);
    }

    if (enrichmentCache.size > ENRICHMENT_CACHE_LIMIT) {
      enrichmentCache.clear();
      for (const entry of result) {
        const details = entry.details;
        const promptPos = entry.image.promptSummary?.positivePrompt ?? details.positivePrompt ?? "";
        const promptNeg = entry.image.promptSummary?.negativePrompt ?? details.negativePrompt ?? "";
        const modelStr = entry.image.promptSummary?.model ?? details.model ?? "";
        const fingerprint = `${promptPos.length}:${promptNeg.length}:${modelStr}:${excludedTagsKey}`;
        enrichmentCache.set(entry.image.id, { enriched: entry, fingerprint });
      }
    }

    return result;
  }, [rootFilteredImages, excludedTagSet]);

  const detailsById = useMemo(() => {
    return new Map(enrichedImages.map((entry) => [entry.image.id, entry.details]));
  }, [enrichedImages]);

  // ── Path tree ─────────────────────────────────────────────────────

  const { tree: pathTree, index: pathTreeIndex } = useMemo(() => {
    return buildPathTree(rootFilteredImages);
  }, [rootFilteredImages]);

  const selectedPathNode = useMemo(() => {
    if (!selectedPathNodeState) return null;
    return pathTreeIndex.has(selectedPathNodeState) ? selectedPathNodeState : null;
  }, [pathTreeIndex, selectedPathNodeState]);

  const currentPathTreeNodes = useMemo(() => {
    if (!selectedPathNode) return pathTree;
    return pathTreeIndex.get(selectedPathNode)?.children ?? [];
  }, [pathTree, pathTreeIndex, selectedPathNode]);

  const deepestPathTreeNodes = useMemo(() => {
    return getDeepestNodes(currentPathTreeNodes);
  }, [currentPathTreeNodes]);

  const selectedPathBreadcrumb = useMemo(() => {
    if (!selectedPathNode) return [];
    const breadcrumb: PathTreeNode[] = [];
    let cursor = pathTreeIndex.get(selectedPathNode);
    while (cursor) {
      breadcrumb.unshift(cursor);
      cursor = cursor.parentKey ? pathTreeIndex.get(cursor.parentKey) : undefined;
    }
    return breadcrumb;
  }, [pathTreeIndex, selectedPathNode]);

  const deepestSelectedPath = useMemo(() => {
    if (selectedPathBreadcrumb.length === 0) return null;
    return selectedPathBreadcrumb[selectedPathBreadcrumb.length - 1];
  }, [selectedPathBreadcrumb]);

  // ── Preset exclusion sets ─────────────────────────────────────────

  const presetPositiveExclusionSet = useMemo(
    () => new Set(activeTagFilterPreset?.positiveTags ?? []),
    [activeTagFilterPreset],
  );
  const presetNegativeExclusionSet = useMemo(
    () => new Set(activeTagFilterPreset?.negativeTags ?? []),
    [activeTagFilterPreset],
  );

  // ── Filtered images ───────────────────────────────────────────────

  const filteredEnrichedImages = useMemo(() => {
    const fileQuery = deferredSearchTerm.trim().toLowerCase();
    const selectedPathPrefix = selectedPathNode;
    const nextFiltered: EnrichedImage[] = [];

    for (const entry of enrichedImages) {
      const image = entry.image;
      if (selectedPathPrefix) {
        const imageDirectoryKey = normalizePathKey(getDirectoryPath(image.absolutePath));
        if (!isWithinPathPrefix(imageDirectoryKey, selectedPathPrefix)) continue;
      }
      if (fileQuery && !image.fileName.toLowerCase().includes(fileQuery)) continue;
      if (includesAnyTag(entry.positiveTags, presetPositiveExclusionSet)) continue;
      if (includesAnyTag(entry.negativeTags, presetNegativeExclusionSet)) continue;
      if (!matchesTagFilter(entry.positiveTagSet, selectedPositiveTags, tagLogicalMode)) continue;
      if (!matchesTagFilter(entry.negativeTagSet, selectedNegativeTags, tagLogicalMode)) continue;
      if (!matchesModelFilter(entry.model, selectedModelTagSet)) continue;
      if (showOnlyUntagged && entry.positiveTags.length > 0) continue;

      nextFiltered.push(entry);
    }

    // Apply sorting
    if (sortOrder !== "none") {
      nextFiltered.sort((a, b) => {
        const aTime = new Date(a.image.modifiedAt).getTime();
        const bTime = new Date(b.image.modifiedAt).getTime();
        return sortOrder === "newest" ? bTime - aTime : aTime - bTime;
      });
    }

    return nextFiltered;
  }, [
    enrichedImages,
    deferredSearchTerm,
    selectedPathNode,
    presetPositiveExclusionSet,
    presetNegativeExclusionSet,
    tagLogicalMode,
    selectedPositiveTags,
    selectedNegativeTags,
    selectedModelTagSet,
    showOnlyUntagged,
    sortOrder,
  ]);

  const filteredImages = useMemo(() => {
    return filteredEnrichedImages.map((entry) => entry.image);
  }, [filteredEnrichedImages]);

  const filterSignature = useMemo(() => {
    const normalizedPositiveSelection = [...selectedPositiveTags].sort().join(",");
    const normalizedNegativeSelection = [...selectedNegativeTags].sort().join(",");
    const normalizedModelSelection = [...selectedModelTags].sort().join(",");

    return [
      selectedRootId,
      selectedPathNode ?? "none",
      deferredSearchTerm,
      activeTagFilterPreset?.id ?? "none",
      normalizedPositiveSelection,
      normalizedNegativeSelection,
      normalizedModelSelection,
      tagLogicalMode,
    ].join("::");
  }, [
    selectedRootId,
    selectedPathNode,
    deferredSearchTerm,
    activeTagFilterPreset?.id,
    selectedPositiveTags,
    selectedNegativeTags,
    selectedModelTags,
    tagLogicalMode,
  ]);

  // Sliding window: keep at most MAX_WINDOW_SIZE images rendered.
  const windowStart =
    windowState.signature === filterSignature ? windowState.start : 0;
  const windowEnd =
    windowState.signature === filterSignature ? windowState.end : IMAGE_BATCH_SIZE;

  const filteredCount = filteredImages.length;

  const slideWindowDown = useCallback(() => {
    setWindowState((prev) => {
      const base =
        prev.signature === filterSignature
          ? prev
          : { start: 0, end: IMAGE_BATCH_SIZE, signature: filterSignature };
      const newEnd = Math.min(base.end + IMAGE_BATCH_SIZE, filteredCount);
      const windowSize = newEnd - base.start;
      const newStart =
        windowSize > MAX_WINDOW_SIZE ? newEnd - MAX_WINDOW_SIZE : base.start;
      return { start: newStart, end: newEnd, signature: filterSignature };
    });
  }, [filterSignature, filteredCount]);

  const slideWindowUp = useCallback(() => {
    setWindowState((prev) => {
      if (prev.start <= 0 && prev.signature === filterSignature) return prev;
      const base =
        prev.signature === filterSignature
          ? prev
          : { start: 0, end: IMAGE_BATCH_SIZE, signature: filterSignature };
      const newStart = Math.max(0, base.start - IMAGE_BATCH_SIZE);
      const windowSize = base.end - newStart;
      const newEnd =
        windowSize > MAX_WINDOW_SIZE ? newStart + MAX_WINDOW_SIZE : base.end;
      return { start: newStart, end: newEnd, signature: filterSignature };
    });
  }, [filterSignature]);

  const visibleImageCount = Math.min(windowEnd, filteredCount) - windowStart;

  const visibleImages = useMemo(() => {
    return filteredImages.slice(windowStart, windowEnd);
  }, [filteredImages, windowStart, windowEnd]);

  const canShowMoreImages = windowEnd < filteredImages.length;
  const canShowPreviousImages = windowStart > 0;

  // ── Tag counts ────────────────────────────────────────────────────

  const positiveTagCounts = useMemo(() => {
    return sortTagCounts(buildTagCounts(enrichedImages.flatMap((e) => e.positiveTags)));
  }, [enrichedImages]);

  const negativeTagCounts = useMemo(() => {
    return sortTagCounts(buildTagCounts(enrichedImages.flatMap((e) => e.negativeTags)));
  }, [enrichedImages]);

  const modelCounts = useMemo(() => {
    const tags = enrichedImages.map((e) => e.model).filter((v): v is string => Boolean(v));
    return sortTagCounts(buildTagCounts(tags));
  }, [enrichedImages]);

  // ── Helpers ───────────────────────────────────────────────────────

  const toggleTagSelection = useCallback(
    (tag: string, setSelected: Dispatch<SetStateAction<string[]>>) => {
      setSelected((current) => toggleStringInList(current, tag));
    },
    [],
  );

  const showMoreImages = slideWindowDown;

  const clearAllFilters = useCallback(() => {
    setSelectedRootId("all");
    setSearchTerm("");
    setSelectedPathNode(null);
    setSelectedPositiveTagsState([]);
    setSelectedNegativeTagsState([]);
    setSelectedModels([]);
    setTagLogicalMode("and");
    setSortOrder("none");
    setShowOnlyUntagged(false);
  }, []);

  return {
    selectedRootId,
    setSelectedRootId,
    searchTerm,
    setSearchTerm,
    selectedPathNode,
    setSelectedPathNode,
    selectedPositiveTags,
    setSelectedPositiveTags: setSelectedPositiveTagsState,
    selectedNegativeTags,
    setSelectedNegativeTags: setSelectedNegativeTagsState,
    selectedModels: selectedModelTags,
    setSelectedModels,
    tagLogicalMode,
    setTagLogicalMode,
    sortOrder,
    setSortOrder,
    showOnlyUntagged,
    setShowOnlyUntagged,
    enrichedImages,
    filteredImages,
    visibleImages,
    visibleImageCount,
    windowStart,
    windowEnd,
    canShowMoreImages,
    canShowPreviousImages,
    slideWindowDown,
    slideWindowUp,
    excludedTagSet,
    detailsById,
    pathTree,
    pathTreeIndex,
    currentPathTreeNodes,
    deepestPathTreeNodes,
    selectedPathBreadcrumb,
    deepestSelectedPath,
    positiveTagCounts,
    negativeTagCounts,
    modelCounts,
    toggleTagSelection,
    showMoreImages,
    clearAllFilters,
  };
}
