"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GraphFilterPanel } from "@/app/library/components/GraphFilterPanel";
import { Lightbox } from "@/app/library/components/Lightbox";
import { PathInput } from "@/components/PathInput";
import { TagSelect } from "@/components/TagSelect";
import { deleteImages } from "@/lib/library/bulk-delete";
import type { CatalogSort, GraphScope } from "@/lib/library/schemas";
import {
  gridColumnsClass,
  masonryColumnsClass,
  useSettings,
  type SortMode,
  type ViewMode,
} from "@/lib/store/settings";

type SafetyClass = "sfw" | "nsfw" | "explicit";
const SAFETY_CLASSES: SafetyClass[] = ["sfw", "nsfw", "explicit"];
const SAFETY_LABEL: Record<SafetyClass, string> = {
  sfw: "SFW",
  nsfw: "NSFW",
  explicit: "Explicit",
};

interface CompactResult {
  imageId: string;
  score?: number | null;
  thumbnailUrl: string;
  summary: string;
  tags: string[];
  model?: string | null;
  checkpoint?: string | null;
  rating?: number | null;
  safety?: SafetyClass | null;
}

interface JobSummary {
  id: string;
  folderPath: string | null;
  status: string;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
}

interface SimilarRef {
  id: string;
  thumbUrl: string;
  summary: string;
}

type BrowseMode = "browse" | "semantic" | "image" | "similar";

const SORT_LABEL: Record<SortMode, string> = {
  relevance: "Relevance",
  newest: "Newest",
  oldest: "Oldest",
  rating_desc: "Rating ↓",
  rating_asc: "Rating ↑",
  name_asc: "Name A–Z",
  name_desc: "Name Z–A",
};

// Sort options offered per context. The vector-search path is relevance-ranked
// and its results carry no date/filename, so only relevance + rating (a
// client-side reorder of the loaded window) make sense there; browse offers the
// full server-side set.
const BROWSE_SORTS: SortMode[] = ["newest", "oldest", "rating_desc", "rating_asc", "name_asc", "name_desc"];
const SEARCH_SORTS: SortMode[] = ["relevance", "rating_desc", "rating_asc"];

/** The catalog browse path is used only for filter-only browsing (no query). */
function isBrowsePath(mode: BrowseMode, query: string): boolean {
  return mode === "browse" && query.trim() === "";
}

/** Rank tags by frequency across the loaded results for the autocomplete. */
function rankTags(results: CompactResult[]): string[] {
  const counts = new Map<string, number>();
  for (const r of results) {
    for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

const cls = {
  card: "rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 p-4",
  input: "w-full rounded-lg border border-ui-border/70 bg-ui-bg px-3 py-2 text-ui-sm outline-none focus:border-accent-cyan",
  btn: "rounded-lg border border-ui-border/70 bg-ui-bg-soft px-3 py-2 text-ui-sm font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50",
  btnActive: "border-accent-cyan text-accent-cyan",
  label: "flex flex-col gap-1 text-ui-2xs font-medium uppercase tracking-wide text-ui-ink-muted",
};

function csv(value: string): string[] {
  return value.split(",").map((t) => t.trim()).filter(Boolean);
}

function StarRating({ value }: { value: number }) {
  return (
    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-ui-2xs text-amber-500">
      {"★".repeat(Math.min(5, value))}
    </span>
  );
}

export default function LibraryPage() {
  const { settings, hydrated, setKey } = useSettings();

  // Browse / filter state — seeded from saved settings (defaults until hydrated).
  const [mode, setMode] = useState<BrowseMode>("browse");
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [modelFamily, setModelFamily] = useState("");
  const [checkpoint, setCheckpoint] = useState("");
  const [loras, setLoras] = useState("");
  const [sourceTool, setSourceTool] = useState("");
  const [favorites, setFavorites] = useState(settings.defaultFavoritesOnly);
  const [minRating, setMinRating] = useState(settings.defaultMinRating);
  // Content-safety multi-select: which classes to SHOW. All on = no filter.
  const [safety, setSafety] = useState<SafetyClass[]>(SAFETY_CLASSES);
  const [limit, setLimit] = useState(settings.pageSize);
  const [minScore, setMinScore] = useState(settings.defaultMinScore);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [similarRef, setSimilarRef] = useState<SimilarRef | null>(null);
  const [graphScope, setGraphScope] = useState<GraphScope | null>(null);

  // Reverse-image search panel toggle (the inline dropzone).
  const [showImageSearch, setShowImageSearch] = useState(false);
  // External (pasted / uploaded) image to search against — never persisted.
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageNote, setImageNote] = useState<string | null>(null);

  // Results
  const [results, setResults] = useState<CompactResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Freshness: while browsing newest-first, a background poll watches the head
  // of the catalog so newly-ingested images surface without a manual reload.
  const [hasNew, setHasNew] = useState(false);
  const newestIdRef = useRef<string | null>(null);

  // Fullscreen viewer / slideshow
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxAutoPlay, setLightboxAutoPlay] = useState(false);

  // Bulk selection / delete. In select mode a card click toggles selection
  // instead of opening the viewer; "Delete selected" un-indexes each picked
  // image (catalog + search + graph), leaving the originals on disk.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // System
  const [health, setHealth] = useState<Record<string, boolean> | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [folderPath, setFolderPath] = useState("");
  const [showIngest, setShowIngest] = useState(false);

  // Stable ref for current filter values — lets doFetch() always read fresh state
  // even when called from callbacks that close over an older render.
  const filtersRef = useRef({
    mode, query, tags, excludeTags, modelFamily, checkpoint, loras, sourceTool,
    favorites, minRating, safety, limit, minScore, similarRef, imageFile, graphScope,
    sort: settings.sortMode,
  });
  useEffect(() => {
    filtersRef.current = {
      mode, query, tags, excludeTags, modelFamily, checkpoint, loras, sourceTool,
      favorites, minRating, safety, limit, minScore, similarRef, imageFile, graphScope,
      sort: settings.sortMode,
    };
  });

  const doFetch = useCallback(
    async (append: boolean, overrides?: Partial<typeof filtersRef.current>) => {
      const s = { ...filtersRef.current, ...overrides };

      // A fresh search invalidates the open viewer (its indices no longer map)
      // and any pending bulk selection (those ids may not be in the new set).
      // It also re-baselines the freshness poll: whatever we load now becomes
      // the "seen" head, so the New-images banner only fires on later arrivals.
      if (!append) {
        setLightboxIndex(null);
        setSelected(new Set());
        setConfirmingBulk(false);
        setHasNew(false);
        newestIdRef.current = null;
      }

      // Image mode with no image yet: nothing to search.
      if (s.mode === "image" && !s.imageFile) {
        setResults([]);
        setHasMore(false);
        return;
      }

      setLoading(true);
      setError(null);

      const pageSize = s.limit;
      const pageOffset = append ? pageRef.current * pageSize : 0;
      const safetySubset =
        s.safety.length > 0 && s.safety.length < SAFETY_CLASSES.length ? s.safety : undefined;
      const ratingGte = s.minRating > 0 ? s.minRating : undefined;
      const filters = {
        tags: s.tags.length ? s.tags : undefined,
        excludeTags: s.excludeTags.length ? s.excludeTags : undefined,
        modelFamily: s.modelFamily.trim() || undefined,
        checkpoint: s.checkpoint.trim() || undefined,
        loras: csv(s.loras).length ? csv(s.loras) : undefined,
        sourceTool: s.sourceTool.trim() || undefined,
        favorite: s.favorites || undefined,
        ratingGte,
        // Only send a safety filter when a strict subset is selected; all (or
        // none) selected means "no filter" so unclassified images stay visible.
        safety: safetySubset,
      };

      try {
        let fresh: CompactResult[] = [];
        let more = false;

        if (s.mode === "similar" && s.similarRef) {
          const r = await fetch("/api/library/search/similar", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ imageId: s.similarRef.id, filters, limit: pageSize, minScore: s.minScore, graphScope: s.graphScope ?? undefined }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "Similarity search failed");
          fresh = j.results ?? [];
        } else if (s.mode === "image" && s.imageFile) {
          const fd = new FormData();
          fd.append("file", s.imageFile);
          fd.append("options", JSON.stringify({ filters, limit: pageSize, minScore: s.minScore, graphScope: s.graphScope ?? undefined }));
          const r = await fetch("/api/library/search/by-image", { method: "POST", body: fd });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "Image search failed");
          fresh = j.results ?? [];
          setImageNote(
            j.semantic
              ? `Visual similarity · ${j.provider}`
              : "Visual similarity · local color/layout features (CLIP not configured)",
          );
        } else if (isBrowsePath(s.mode, s.query)) {
          // Filter-only browse over the catalog truth: real server-side sort +
          // offset pagination (the vector /search needs a query and can't sort by
          // date/name). `relevance` has no meaning without a query, so it maps to
          // newest here. Only catalog-backed filters apply (model/lora/source-tool
          // are vector-only and silently skipped on this path).
          const browseSort: CatalogSort = s.sort === "relevance" ? "newest" : s.sort;
          const r = await fetch("/api/library/browse", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              tags: filters.tags,
              excludeTags: filters.excludeTags,
              favorite: filters.favorite,
              ratingGte: filters.ratingGte,
              safety: filters.safety,
              sort: browseSort,
              limit: pageSize,
              offset: pageOffset,
            }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "Browse failed");
          fresh = j.results ?? [];
          more = j.hasMore ?? fresh.length === pageSize;
        } else {
          // Unified text / filter search. The gateway encodes the text query into
          // dense+sparse vectors, so this is the hybrid "browse + semantic" path.
          const r = await fetch("/api/library/search", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              query: s.query || undefined,
              ...filters,
              graphScope: s.graphScope ?? undefined,
              limit: pageSize,
              offset: pageOffset,
            }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "Search failed");
          fresh = j.results ?? [];
          more = fresh.length === pageSize;
        }

        if (append) {
          pageRef.current += 1;
          setResults((prev) => [...prev, ...fresh]);
        } else {
          pageRef.current = 1;
          setResults(fresh);
        }
        setHasMore(more);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Run a plain text / filter search, dropping any active image / similar query.
  const search = useCallback(() => {
    setSimilarRef(null);
    setImageFile(null);
    setImageNote(null);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setMode("browse");
    doFetch(false, { mode: "browse", similarRef: null, imageFile: null });
  }, [doFetch]);

  const loadMore = useCallback(() => doFetch(true), [doFetch]);

  const openLightbox = useCallback((index: number, autoplay = false) => {
    setLightboxAutoPlay(autoplay);
    setLightboxIndex(index);
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setConfirmingBulk(false);
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
    setConfirmingBulk(false);
  }, []);

  // Un-index every selected image, fanning the per-image delete out with bounded
  // concurrency. Whatever actually went away is pruned from the grid even on a
  // partial failure; the rest stay selected with the reason surfaced.
  const deleteSelected = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkDeleting(true);
    setError(null);
    try {
      const { deleted, failed } = await deleteImages(ids);
      if (deleted.length > 0) {
        const gone = new Set(deleted);
        setResults((prev) => prev.filter((r) => !gone.has(r.imageId)));
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of gone) next.delete(id);
          return next;
        });
      }
      if (failed.length > 0) {
        setError(
          `Deleted ${deleted.length}/${ids.length}. ${failed.length} failed: ${failed[0].error}`,
        );
        setConfirmingBulk(false);
      } else {
        exitSelectMode();
      }
    } finally {
      setBulkDeleting(false);
    }
  }, [selected, exitSelectMode]);

  const findSimilar = useCallback(
    (id: string, thumbUrl: string, summary: string) => {
      const ref: SimilarRef = { id, thumbUrl, summary };
      setSimilarRef(ref);
      setMode("similar");
      doFetch(false, { mode: "similar", similarRef: ref });
    },
    [doFetch],
  );

  const clearSimilar = useCallback(() => {
    setSimilarRef(null);
    setMode("browse");
    doFetch(false, { mode: "browse", similarRef: null });
  }, [doFetch]);

  // Accept an external image (paste / drop / file pick) and immediately search.
  const applyExternalImage = useCallback(
    (file: File) => {
      setImageFile(file);
      setSimilarRef(null);
      setImagePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setMode("image");
      doFetch(false, { mode: "image", imageFile: file, similarRef: null });
    },
    [doFetch],
  );

  // Drop the image query and return to text/filter browsing.
  const clearImage = useCallback(() => {
    setImageFile(null);
    setImageNote(null);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setMode("browse");
    doFetch(false, { mode: "browse", imageFile: null });
  }, [doFetch]);

  // Global clipboard paste while the image panel is open — paste a screenshot.
  useEffect(() => {
    if (!showImageSearch && mode !== "image") return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        applyExternalImage(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [showImageSearch, mode, applyExternalImage]);

  // Health + job polling (independent of saved settings).
  useEffect(() => {
    fetch("/api/library/health")
      .then((r) => r.json())
      .then((j) => setHealth(j.services ?? null))
      .catch(() => {});

    const pollJobs = () =>
      fetch("/api/library/jobs")
        .then((r) => r.json())
        .then((j) => { if (j.jobs) setJobs(j.jobs); })
        .catch(() => {});
    pollJobs();
    const id = setInterval(pollJobs, 3000);
    return () => clearInterval(id);
  }, []);

  // First search — wait for saved settings so pagination / filter defaults
  // apply, and honour ?tags= / ?q= / ?mode= deep links (e.g. a related-tag
  // click on the image viewer).
  const didInit = useRef(false);
  useEffect(() => {
    if (!hydrated || didInit.current) return;
    didInit.current = true;

    const sp = new URLSearchParams(window.location.search);
    const qpTags = csv(sp.get("tags") ?? "");
    const qpQuery = sp.get("q") ?? "";
    const qpMode = sp.get("mode");
    const wantImage = qpMode === "image" || (!qpMode && settings.defaultMode === "image");
    const initialMode: BrowseMode = wantImage ? "image" : "browse";

    if (qpTags.length) setTags(qpTags);
    if (qpQuery) setQuery(qpQuery);
    if (wantImage) setShowImageSearch(true);
    setMode(initialMode);
    setFavorites(settings.defaultFavoritesOnly);
    setMinRating(settings.defaultMinRating);
    setMinScore(settings.defaultMinScore);
    setLimit(settings.pageSize);
    doFetch(false, {
      mode: initialMode,
      tags: qpTags,
      query: qpQuery,
      favorites: settings.defaultFavoritesOnly,
      minRating: settings.defaultMinRating,
      minScore: settings.defaultMinScore,
      limit: settings.pageSize,
      similarRef: null,
      imageFile: null,
    });
  }, [hydrated, settings, doFetch]);

  // Infinite scroll: auto-load the next page as the sentinel nears the viewport.
  useEffect(() => {
    if (!settings.infiniteScroll || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) loadMore();
      },
      { rootMargin: "600px" },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [settings.infiniteScroll, hasMore, loading, loadMore]);

  // Freshness poll: while filter-only browsing, watch the newest catalog head for
  // the current filter set. When a newer image than the one we baselined appears
  // (ingest finished, a backfill landed), raise the "new images" banner instead
  // of silently going stale. Only runs on the browse path — search results are a
  // point-in-time ranking, not a live feed.
  useEffect(() => {
    if (!isBrowsePath(mode, query)) {
      setHasNew(false);
      return;
    }
    const safetySubset =
      safety.length > 0 && safety.length < SAFETY_CLASSES.length ? safety : undefined;
    const body = {
      tags: tags.length ? tags : undefined,
      excludeTags: excludeTags.length ? excludeTags : undefined,
      favorite: favorites || undefined,
      ratingGte: minRating > 0 ? minRating : undefined,
      safety: safetySubset,
      sort: "newest" as const,
      limit: 1,
      offset: 0,
    };
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch("/api/library/browse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) return;
        const j = await r.json();
        const topId: string | null = j.results?.[0]?.imageId ?? null;
        if (!alive || !topId) return;
        if (newestIdRef.current === null) newestIdRef.current = topId;
        else if (topId !== newestIdRef.current) setHasNew(true);
      } catch {
        // transient — try again next tick
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mode, query, tags, excludeTags, favorites, minRating, safety]);

  const startIngest = async () => {
    if (!folderPath.trim()) return;
    try {
      const r = await fetch("/api/library/ingest/folder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath: folderPath.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Ingest failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ingest failed");
    }
  };

  const imagePanelOpen = showImageSearch || mode === "image";

  // Which result source is live. Browse is server-sorted + paginated; the vector
  // path is relevance-ranked, so it only offers relevance + a client rating sort.
  const browsePath = isBrowsePath(mode, query);
  const sortOptions = browsePath ? BROWSE_SORTS : SEARCH_SORTS;
  const sortValue: SortMode = sortOptions.includes(settings.sortMode)
    ? settings.sortMode
    : sortOptions[0];

  // Autocomplete pool for the tag pickers — tags on the loaded results, most
  // common first (we have no library-wide tag-list endpoint).
  const tagSuggestions = useMemo(() => rankTags(results), [results]);

  // The vector path can't sort by date/name (its rows lack them), so honour a
  // rating sort by reordering the loaded window client-side. Browse is already
  // ordered by the server, so it passes through untouched. The grid AND the
  // lightbox both read this so their indices stay in lockstep.
  const displayResults = useMemo(() => {
    if (browsePath || (sortValue !== "rating_desc" && sortValue !== "rating_asc")) {
      return results;
    }
    const dir = sortValue === "rating_desc" ? -1 : 1;
    const nullVal = dir === -1 ? -Infinity : Infinity;
    return [...results].sort(
      (a, b) => ((a.rating ?? nullVal) - (b.rating ?? nullVal)) * dir,
    );
  }, [results, browsePath, sortValue]);

  const changeSort = (next: SortMode) => {
    setKey("sortMode", next);
    // Browse ordering lives on the server, so a change must re-page from the top;
    // the vector path only needs the client reorder above.
    if (browsePath) doFetch(false, { sort: next });
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-ui-2xl font-semibold text-ui-ink-title">Image Library</h1>
          <p className="text-ui-sm text-ui-ink-muted">
            {results.length > 0
              ? `${results.length}${hasMore ? "+" : ""} images · Postgres · Neo4j · Qdrant`
              : "Postgres · Neo4j · Qdrant"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            disabled={results.length === 0}
            aria-pressed={selectMode}
            className={`flex items-center gap-1.5 rounded-lg border bg-ui-bg px-2.5 py-1.5 text-ui-2xs font-medium transition disabled:opacity-40 ${
              selectMode
                ? "border-accent-cyan text-accent-cyan"
                : "border-ui-border/60 text-ui-ink-muted hover:border-accent-cyan hover:text-accent-cyan"
            }`}
            title="Select multiple images to delete"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 11l3 3 8-8" />
              <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
            </svg>
            {selectMode ? "Done" : "Select"}
          </button>
          <button
            onClick={() => openLightbox(0, true)}
            disabled={results.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-ui-border/60 bg-ui-bg px-2.5 py-1.5 text-ui-2xs font-medium text-ui-ink-muted transition hover:border-accent-cyan hover:text-accent-cyan disabled:opacity-40"
            title="Play all results as a slideshow"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            Slideshow
          </button>
          <label className="flex items-center gap-1.5 rounded-lg border border-ui-border/60 bg-ui-bg px-2 py-1 text-ui-2xs text-ui-ink-muted">
            <span className="hidden sm:inline">Sort</span>
            <select
              value={sortValue}
              onChange={(e) => changeSort(e.target.value as SortMode)}
              className="bg-transparent text-ui-2xs font-medium text-ui-ink outline-none"
              aria-label="Sort results"
            >
              {sortOptions.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-0.5 rounded-lg border border-ui-border/60 bg-ui-bg p-0.5" role="group" aria-label="Result layout">
            {([
              ["grid", "Grid"],
              ["masonry", "Masonry"],
              ["list", "List"],
            ] as Array<[ViewMode, string]>).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setKey("viewMode", v)}
                aria-pressed={settings.viewMode === v}
                className={`rounded-md px-2 py-1 text-ui-2xs font-medium transition ${
                  settings.viewMode === v
                    ? "bg-accent-cyan/15 text-accent-cyan"
                    : "text-ui-ink-muted hover:text-ui-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {health &&
            Object.entries(health).map(([name, up]) => (
              <span
                key={name}
                className={`rounded-full px-2 py-1 text-ui-2xs ${up ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500"}`}
              >
                {name} {up ? "ok" : "down"}
              </span>
            ))}
        </div>
      </header>

      {/* Unified search & filter panel */}
      <section className={cls.card}>
        <div className="flex flex-col gap-3">
          {/* Search bar */}
          <div className="flex flex-wrap items-stretch gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-ink-muted"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                className="w-full rounded-lg border border-ui-border/70 bg-ui-bg py-2 pl-9 pr-3 text-ui-sm outline-none focus:border-accent-cyan"
                placeholder="Search prompts, tags, filenames — or describe what you want…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
              />
            </div>
            <button
              className={`${cls.btn} flex items-center gap-1.5 ${imagePanelOpen ? cls.btnActive : ""}`}
              onClick={() => {
                if (imagePanelOpen) {
                  setShowImageSearch(false);
                  if (mode === "image") clearImage();
                } else {
                  setShowImageSearch(true);
                }
              }}
              aria-pressed={imagePanelOpen}
              title="Search by image"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4l-1.5-2z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              <span className="hidden sm:inline">By image</span>
            </button>
            <button className={cls.btn} onClick={search} disabled={loading}>
              {loading ? "Loading…" : "Search"}
            </button>
          </div>

          {/* Inline reverse-image dropzone */}
          {imagePanelOpen && (
            <ImageDropzone
              preview={imagePreview}
              note={imageNote}
              onFile={applyExternalImage}
              onClear={clearImage}
            />
          )}

          {/* Active "similar to" query banner */}
          {similarRef && (
            <div className="flex items-center gap-3 rounded-lg border border-accent-cyan/40 bg-accent-cyan/5 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={similarRef.thumbUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded-lg border border-ui-border/60 object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="text-ui-xs font-medium text-accent-cyan">Showing images similar to</p>
                <p className="truncate text-ui-xs text-ui-ink-muted">{similarRef.summary}</p>
              </div>
              <button
                className="rounded-lg border border-ui-border/60 px-2 py-1 text-ui-xs text-ui-ink-muted transition hover:border-accent-cyan hover:text-accent-cyan"
                onClick={clearSimilar}
              >
                Clear
              </button>
            </div>
          )}

          {/* Filters. Tags / favorites / rating apply instantly (they're cheap
              server filters); the free-text model field still commits on Enter. */}
          <TagSelect
            value={tags}
            onChange={setTags}
            onCommit={(next) => doFetch(false, { tags: next })}
            suggestions={tagSuggestions}
            placeholder="filter by tag — type to add, pick from suggestions…"
            variant="include"
          />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input
              className={cls.input}
              placeholder="model family (sdxl…)"
              value={modelFamily}
              onChange={(e) => setModelFamily(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
            />
            <label className="flex cursor-pointer items-center gap-1.5 text-ui-xs text-ui-ink">
              <input
                type="checkbox"
                checked={favorites}
                onChange={(e) => {
                  setFavorites(e.target.checked);
                  doFetch(false, { favorites: e.target.checked });
                }}
                className="rounded"
              />
              Favorites only
            </label>
            <select
              className="rounded-lg border border-ui-border/70 bg-ui-bg px-2 py-2 text-ui-xs outline-none focus:border-accent-cyan"
              value={minRating}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMinRating(v);
                doFetch(false, { minRating: v });
              }}
            >
              <option value={0}>Any rating</option>
              <option value={1}>★+</option>
              <option value={2}>★★+</option>
              <option value={3}>★★★+</option>
              <option value={4}>★★★★+</option>
              <option value={5}>★★★★★</option>
            </select>
          </div>

          {/* Content-safety filter — multi-select chips. All on = no filter
              (everything, incl. unclassified); a subset shows only those classes. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-ui-2xs font-medium uppercase tracking-wide text-ui-ink-muted">
              Safety
            </span>
            {SAFETY_CLASSES.map((c) => {
              const on = safety.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? safety.filter((x) => x !== c) : [...safety, c];
                    setSafety(next);
                    doFetch(false, { safety: next });
                  }}
                  className={`rounded-full border px-2.5 py-1 text-ui-2xs font-medium transition ${
                    on
                      ? "border-accent-cyan bg-accent-cyan/15 text-accent-cyan"
                      : "border-ui-border/60 text-ui-ink-muted hover:text-ui-ink"
                  }`}
                >
                  {SAFETY_LABEL[c]}
                </button>
              );
            })}
          </div>

          <GraphFilterPanel
            value={graphScope}
            relatedImageId={similarRef?.id}
            onChange={(scope) => { setGraphScope(scope); doFetch(false, { graphScope: scope }); }}
          />

          {/* Advanced filters */}
          <button
            className="flex items-center gap-1.5 self-start text-ui-xs font-medium text-ui-ink-muted transition hover:text-ui-ink"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            Advanced filters
          </button>

          {showAdvanced && (
            <div className="grid gap-3 rounded-lg border border-ui-border/40 bg-ui-bg/40 p-3 sm:grid-cols-2 lg:grid-cols-3">
              <p className="col-span-full text-ui-2xs text-ui-ink-muted/70">
                Tags, rating, favorite & safety filter plain browsing too. Model,
                checkpoint, LoRA & source-tool apply when a text or image search is active.
              </p>
              <label className={cls.label}>
                Exclude tags
                <TagSelect
                  value={excludeTags}
                  onChange={setExcludeTags}
                  onCommit={(next) => doFetch(false, { excludeTags: next })}
                  suggestions={tagSuggestions}
                  placeholder="tags to hide…"
                  variant="exclude"
                />
              </label>
              <label className={cls.label}>
                Checkpoint
                <input
                  className={cls.input}
                  placeholder="checkpoint name…"
                  value={checkpoint}
                  onChange={(e) => setCheckpoint(e.target.value)}
                />
              </label>
              <label className={cls.label}>
                LoRAs
                <input
                  className={cls.input}
                  placeholder="comma-separated"
                  value={loras}
                  onChange={(e) => setLoras(e.target.value)}
                />
              </label>
              <label className={cls.label}>
                Source tool
                <input
                  className={cls.input}
                  placeholder="comfyui, a1111…"
                  value={sourceTool}
                  onChange={(e) => setSourceTool(e.target.value)}
                />
              </label>
              <label className={cls.label}>
                Results: {limit}
                <input
                  type="range"
                  min={10}
                  max={200}
                  step={10}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="accent-accent-cyan"
                />
              </label>
              <label className={cls.label}>
                Min similarity: {minScore.toFixed(2)}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="accent-accent-cyan"
                />
                <span className="text-ui-2xs normal-case tracking-normal text-ui-ink-muted/70">
                  applies to similar / by-image
                </span>
              </label>
            </div>
          )}
        </div>
      </section>

      {error && <p className="text-ui-sm text-rose-500">{error}</p>}

      {/* Freshness banner — newer images landed while browsing; reload from top. */}
      {hasNew && (
        <button
          onClick={() => doFetch(false)}
          className="sticky top-2 z-20 mx-auto flex items-center gap-2 rounded-full border border-accent-cyan/50 bg-accent-cyan/15 px-4 py-1.5 text-ui-xs font-medium text-accent-cyan shadow-sm backdrop-blur-sm transition hover:bg-accent-cyan/25"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-9-9" />
            <path d="M21 3v6h-6" />
          </svg>
          New images available — refresh
        </button>
      )}

      {/* Image grid */}
      {results.length === 0 && !loading && (
        <p className="text-ui-sm text-ui-ink-muted">
          {imagePanelOpen
            ? "Paste, drop, or choose an image above to search by visual similarity."
            : "No images found. Ingest a folder below to get started."}
        </p>
      )}

      {/* Bulk-selection toolbar */}
      {selectMode && results.length > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-accent-cyan/40 bg-ui-bg-soft/90 px-3 py-2 backdrop-blur-sm">
          <span className="text-ui-sm font-medium text-ui-ink">
            {selected.size} selected
          </span>
          <button
            className={cls.btn}
            onClick={() => setSelected(new Set(results.map((r) => r.imageId)))}
            disabled={selected.size === results.length}
          >
            Select all
          </button>
          <button className={cls.btn} onClick={clearSelection} disabled={selected.size === 0}>
            Clear
          </button>
          <div className="flex-1" />
          {!confirmingBulk ? (
            <button
              onClick={() => setConfirmingBulk(true)}
              disabled={selected.size === 0}
              className="rounded-lg border border-rose-500/60 px-3 py-2 text-ui-sm font-medium text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-50"
            >
              Delete selected
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ui-xs text-ui-ink-muted">
                Remove {selected.size} image{selected.size === 1 ? "" : "s"} from the
                library? Originals on disk are kept.
              </span>
              <button
                onClick={deleteSelected}
                disabled={bulkDeleting}
                className="rounded-lg bg-rose-500/90 px-3 py-2 text-ui-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-60"
              >
                {bulkDeleting ? "Removing…" : "Remove"}
              </button>
              <button
                onClick={() => setConfirmingBulk(false)}
                disabled={bulkDeleting}
                className={cls.btn}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {results.length > 0 && (
        <ResultsView
          results={displayResults}
          viewMode={settings.viewMode}
          density={settings.gridDensity}
          showScores={settings.showScores}
          showCardMeta={settings.showCardMeta}
          selectMode={selectMode}
          selected={selected}
          onToggleSelect={toggleSelect}
          onSimilar={findSimilar}
          onOpen={openLightbox}
        />
      )}

      {/* Infinite-scroll sentinel + manual "Load more" fallback */}
      {hasMore && (
        <>
          <div ref={sentinelRef} aria-hidden="true" className="h-1" />
          {!settings.infiniteScroll ? (
            <div className="flex justify-center pt-2">
              <button className={cls.btn} onClick={loadMore} disabled={loading}>
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : (
            loading && (
              <p className="pt-2 text-center text-ui-xs text-ui-ink-muted">Loading…</p>
            )
          )}
        </>
      )}

      {/* Ingest panel */}
      <section className={cls.card}>
        <button
          className="flex w-full items-center justify-between text-ui-sm font-medium text-ui-ink"
          onClick={() => setShowIngest(!showIngest)}
        >
          <span>Ingest folder</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className={`h-4 w-4 transition-transform ${showIngest ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {showIngest && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <PathInput
                className="min-w-[12rem] flex-1"
                inputClassName={`${cls.input} flex-1`}
                buttonClassName={cls.btn}
                value={folderPath}
                onChange={setFolderPath}
                onEnter={startIngest}
                placeholder="D:/images/generated"
                pickerTitle="Choose a folder to ingest"
              />
              <button className={cls.btn} onClick={startIngest}>
                Start ingestion
              </button>
            </div>

            {jobs.length > 0 && (
              <ul className="flex flex-col gap-1 text-ui-xs">
                {jobs.slice(0, 6).map((j) => (
                  <li
                    key={j.id}
                    className="flex items-center justify-between rounded bg-ui-bg px-2 py-1"
                  >
                    <span className="truncate">{j.folderPath}</span>
                    <span className="ml-2 shrink-0 text-ui-ink-muted">
                      {j.status} · {j.processedFiles}/{j.totalFiles}
                      {j.failedFiles > 0 ? ` · ${j.failedFiles} err` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Fullscreen viewer / slideshow */}
      {lightboxIndex !== null && displayResults[lightboxIndex] && (
        <Lightbox
          items={displayResults}
          initialIndex={lightboxIndex}
          fullResolution={settings.viewerFullResolution}
          slideshow={{
            interval: settings.slideshowInterval,
            loop: settings.slideshowLoop,
            shuffle: settings.slideshowShuffle,
          }}
          autoPlay={lightboxAutoPlay}
          hasMore={hasMore}
          loadingMore={loading}
          onLoadMore={loadMore}
          onClose={() => setLightboxIndex(null)}
          onSimilar={(it) => {
            setLightboxIndex(null);
            findSimilar(it.imageId, it.thumbnailUrl, it.summary);
          }}
          onToggleFullResolution={() =>
            setKey("viewerFullResolution", !settings.viewerFullResolution)
          }
        />
      )}
    </div>
  );
}

type SimilarHandler = (id: string, thumbUrl: string, summary: string) => void;
type OpenHandler = (index: number) => void;
type ToggleSelectHandler = (id: string) => void;

interface SelectionProps {
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: ToggleSelectHandler;
}

/** Renders the result set in the layout chosen in settings (grid / masonry / list). */
function ResultsView({
  results,
  viewMode,
  density,
  showScores,
  showCardMeta,
  selectMode,
  selected,
  onToggleSelect,
  onSimilar,
  onOpen,
}: {
  results: CompactResult[];
  viewMode: ViewMode;
  density: "compact" | "comfortable" | "spacious";
  showScores: boolean;
  showCardMeta: boolean;
  onSimilar: SimilarHandler;
  onOpen: OpenHandler;
} & SelectionProps) {
  if (viewMode === "list") {
    return (
      <div className="flex flex-col gap-2">
        {results.map((r, i) => (
          <ResultRow
            key={r.imageId}
            r={r}
            index={i}
            showScores={showScores}
            showCardMeta={showCardMeta}
            selectMode={selectMode}
            isSelected={selected.has(r.imageId)}
            onToggleSelect={onToggleSelect}
            onSimilar={onSimilar}
            onOpen={onOpen}
          />
        ))}
      </div>
    );
  }

  const masonry = viewMode === "masonry";
  return (
    <div className={masonry ? `${masonryColumnsClass(density)} gap-3` : `grid ${gridColumnsClass(density)} gap-3`}>
      {results.map((r, i) => (
        <ResultCard
          key={r.imageId}
          r={r}
          index={i}
          masonry={masonry}
          showScores={showScores}
          showCardMeta={showCardMeta}
          selectMode={selectMode}
          isSelected={selected.has(r.imageId)}
          onToggleSelect={onToggleSelect}
          onSimilar={onSimilar}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

/** Checkbox overlay shown on each card/row while in select mode. */
function SelectCheck({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded border transition ${
        checked
          ? "border-accent-cyan bg-accent-cyan text-ui-bg-deep"
          : "border-ui-border/80 bg-ui-bg/80 text-transparent backdrop-blur-sm"
      }`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5 9-11" />
      </svg>
    </span>
  );
}

function CardMeta({ r, showScores }: { r: CompactResult; showScores: boolean }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {showScores && typeof r.score === "number" && r.score > 0 && (
        <span className="rounded bg-accent-cyan/15 px-1.5 py-0.5 text-ui-2xs text-accent-cyan">
          {r.score.toFixed(3)}
        </span>
      )}
      {r.rating && r.rating > 0 && <StarRating value={r.rating} />}
      {(r.safety === "nsfw" || r.safety === "explicit") && (
        <span
          className={`rounded px-1.5 py-0.5 text-ui-2xs font-medium ${
            r.safety === "explicit"
              ? "bg-rose-500/15 text-rose-500"
              : "bg-amber-500/15 text-amber-500"
          }`}
        >
          {SAFETY_LABEL[r.safety]}
        </span>
      )}
      {r.model && (
        <span className="rounded bg-ui-bg px-1.5 py-0.5 text-ui-2xs text-ui-ink-muted">{r.model}</span>
      )}
    </div>
  );
}

/**
 * Left-click opens the fullscreen viewer; modified clicks (Ctrl/Cmd/middle)
 * fall through to the native link so the detail page can still open in a new tab.
 */
function shouldOpenViewer(e: React.MouseEvent): boolean {
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
}

function ResultCard({
  r,
  index,
  masonry,
  showScores,
  showCardMeta,
  selectMode,
  isSelected,
  onToggleSelect,
  onSimilar,
  onOpen,
}: {
  r: CompactResult;
  index: number;
  masonry: boolean;
  showScores: boolean;
  showCardMeta: boolean;
  onSimilar: SimilarHandler;
  onOpen: OpenHandler;
  isSelected: boolean;
} & Omit<SelectionProps, "selected">) {
  return (
    <div
      className={`group relative overflow-hidden rounded-xl border bg-ui-bg-soft/40 transition ${
        isSelected ? "border-accent-cyan ring-2 ring-accent-cyan" : "border-ui-border/60 hover:border-accent-cyan"
      } ${masonry ? "mb-3 break-inside-avoid" : ""}`}
    >
      <a
        href={`/library/${r.imageId}`}
        onClick={(e) => {
          if (selectMode) {
            e.preventDefault();
            onToggleSelect(r.imageId);
            return;
          }
          if (!shouldOpenViewer(e)) return;
          e.preventDefault();
          onOpen(index);
        }}
        className={selectMode ? "block cursor-pointer" : "block cursor-zoom-in"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={r.thumbnailUrl}
          alt={r.summary}
          loading="lazy"
          className={masonry ? "w-full object-cover" : "aspect-square w-full object-cover"}
        />
      </a>

      {/* Selection checkbox (select mode only) */}
      {selectMode && (
        <button
          onClick={() => onToggleSelect(r.imageId)}
          className="absolute left-1.5 top-1.5"
          aria-pressed={isSelected}
          aria-label={isSelected ? "Deselect image" : "Select image"}
        >
          <SelectCheck checked={isSelected} />
        </button>
      )}

      {/* Hover action: find similar (hidden while selecting) */}
      {!selectMode && (
        <div className="pointer-events-none absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            onClick={() => onSimilar(r.imageId, r.thumbnailUrl, r.summary)}
            className="rounded-md border border-ui-border/50 bg-ui-bg/90 px-2 py-1 text-ui-2xs font-medium text-ui-ink backdrop-blur-sm transition hover:border-accent-cyan hover:bg-accent-cyan hover:text-ui-bg-deep"
            title="Find similar images"
          >
            Similar
          </button>
        </div>
      )}

      {showCardMeta && (
        <div className="p-2">
          <p className="line-clamp-2 text-ui-xs text-ui-ink">{r.summary}</p>
          <CardMeta r={r} showScores={showScores} />
        </div>
      )}
    </div>
  );
}

function ResultRow({
  r,
  index,
  showScores,
  showCardMeta,
  selectMode,
  isSelected,
  onToggleSelect,
  onSimilar,
  onOpen,
}: {
  r: CompactResult;
  index: number;
  showScores: boolean;
  showCardMeta: boolean;
  onSimilar: SimilarHandler;
  onOpen: OpenHandler;
  isSelected: boolean;
} & Omit<SelectionProps, "selected">) {
  const open = (e: React.MouseEvent) => {
    if (selectMode) {
      e.preventDefault();
      onToggleSelect(r.imageId);
      return;
    }
    if (!shouldOpenViewer(e)) return;
    e.preventDefault();
    onOpen(index);
  };
  const linkClass = selectMode ? "cursor-pointer" : "cursor-zoom-in";
  return (
    <div
      className={`group flex items-center gap-3 rounded-xl border bg-ui-bg-soft/40 p-2 transition ${
        isSelected ? "border-accent-cyan ring-2 ring-accent-cyan" : "border-ui-border/60 hover:border-accent-cyan"
      }`}
    >
      {selectMode && (
        <button
          onClick={() => onToggleSelect(r.imageId)}
          className="shrink-0"
          aria-pressed={isSelected}
          aria-label={isSelected ? "Deselect image" : "Select image"}
        >
          <SelectCheck checked={isSelected} />
        </button>
      )}
      <a href={`/library/${r.imageId}`} onClick={open} className={`shrink-0 ${linkClass}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={r.thumbnailUrl}
          alt={r.summary}
          loading="lazy"
          className="h-16 w-16 rounded-lg object-cover sm:h-20 sm:w-20"
        />
      </a>
      <div className="min-w-0 flex-1">
        <a href={`/library/${r.imageId}`} onClick={open} className={`block ${linkClass}`}>
          <p className="line-clamp-2 text-ui-sm text-ui-ink">{r.summary}</p>
        </a>
        {showCardMeta && <CardMeta r={r} showScores={showScores} />}
      </div>
      {!selectMode && (
        <button
          onClick={() => onSimilar(r.imageId, r.thumbnailUrl, r.summary)}
          className="shrink-0 rounded-md border border-ui-border/50 bg-ui-bg/90 px-2 py-1 text-ui-2xs font-medium text-ui-ink transition hover:border-accent-cyan hover:bg-accent-cyan hover:text-ui-bg-deep"
          title="Find similar images"
        >
          Similar
        </button>
      )}
    </div>
  );
}

function ImageDropzone({
  preview,
  note,
  onFile,
  onClear,
}: {
  preview: string | null;
  note: string | null;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pickFirstImage = (files: FileList | null | undefined) => {
    const file = Array.from(files ?? []).find((f) => f.type.startsWith("image/"));
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); pickFirstImage(e.dataTransfer.files); }}
      onPaste={(e) => pickFirstImage(e.clipboardData.files)}
      className={`flex items-center gap-4 rounded-lg border border-dashed p-4 transition ${
        dragging ? "border-accent-cyan bg-accent-cyan/10" : "border-ui-border/70 bg-ui-bg/40"
      }`}
    >
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="query"
          className="h-20 w-20 shrink-0 rounded-lg border border-ui-border/60 object-cover"
        />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-ui-border/40 text-ui-ink-muted">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20" />
          </svg>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-ui-sm font-medium text-ui-ink-title">Search by image</p>
        <p className="text-ui-xs text-ui-ink-muted">
          Paste (Ctrl/Cmd+V), drop, or choose a file. The image is embedded and matched — never stored.
        </p>
        {note && <p className="mt-1 text-ui-2xs text-ui-ink-muted/80">{note}</p>}
        <div className="mt-2 flex gap-2">
          <button className={cls.btn} onClick={() => inputRef.current?.click()}>Choose file</button>
          {preview && <button className={cls.btn} onClick={onClear}>Clear</button>}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { pickFirstImage(e.target.files); e.target.value = ""; }}
      />
    </div>
  );
}
