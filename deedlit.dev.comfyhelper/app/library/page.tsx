"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Gallery, TagSelect } from "@deedlit.dev/ui";

import { BulkActionBar, type BulkBusy } from "@/app/library/components/BulkActionBar";
import { GraphFilterPanel } from "@/app/library/components/GraphFilterPanel";
import { Lightbox } from "@/app/library/components/Lightbox";
import { PathInput } from "@/components/PathInput";
import type { ImagePatchBody } from "@/lib/api-client";
import { deleteImages } from "@/lib/library/bulk-delete";
import { moveImages } from "@/lib/library/bulk-move";
import {
  downloadCsv,
  downloadJson,
  downloadJsonl,
  exportImages,
  toSimpleRecord,
  type ExportKind,
} from "@/lib/library/bulk-export";
import { patchImages } from "@/lib/library/bulk-patch";
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
  // Ingested = catalog import date; Created = source-file creation date. They
  // diverge when old images are bulk-imported long after they were made.
  newest: "Ingested · newest",
  oldest: "Ingested · oldest",
  created_desc: "Created · newest",
  created_asc: "Created · oldest",
  rating_desc: "Rating ↓",
  rating_asc: "Rating ↑",
  name_asc: "Name A–Z",
  name_desc: "Name Z–A",
};

// Sort options offered per context. The vector-search path is relevance-ranked
// and its results carry no date/filename, so only relevance + rating (a
// client-side reorder of the loaded window) make sense there; browse offers the
// full server-side set.
const BROWSE_SORTS: SortMode[] = ["newest", "oldest", "created_desc", "created_asc", "rating_desc", "rating_asc", "name_asc", "name_desc"];
const SEARCH_SORTS: SortMode[] = ["relevance", "rating_desc", "rating_asc"];

// How many pages to warm in the background beyond what's rendered, so "load
// more" / infinite scroll lands instantly. The offset-paged paths prefetch
// (browse / search / similar); by-image is single-page.
const PREFETCH_AHEAD = 2;
// Upper bound on the cold restore from `?page=N` — it costs up to N sequential
// page fetches, so cap it however deep the address claims the user had paged.
const MAX_RESTORE_PAGES = 20;

// How many of the most-used tags to surface as one-click filter chips before the
// "+N more" expander reveals the rest of the catalog.
const TAG_CHIP_PREVIEW = 40;

/** The catalog browse path is used only for filter-only browsing (no query). */
function isBrowsePath(mode: BrowseMode, query: string): boolean {
  return mode === "browse" && query.trim() === "";
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
  // Full tag catalog backing the primary filter's show-all-tags picker.
  const [allTags, setAllTags] = useState<string[]>([]);
  const [modelFamily, setModelFamily] = useState("");
  const [checkpoint, setCheckpoint] = useState("");
  const [loras, setLoras] = useState("");
  const [sourceTool, setSourceTool] = useState("");
  // On-disk path fragment — a catalog-backed browse filter (file_path substring).
  const [pathFilter, setPathFilter] = useState("");
  const [favorites, setFavorites] = useState(settings.defaultFavoritesOnly);
  const [minRating, setMinRating] = useState(settings.defaultMinRating);
  // Content-safety multi-select: which classes to SHOW. All on = no filter.
  const [safety, setSafety] = useState<SafetyClass[]>(SAFETY_CLASSES);
  const [limit, setLimit] = useState(settings.pageSize);
  const [minScore, setMinScore] = useState(settings.defaultMinScore);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Expand the one-click "popular tags" chip cloud beyond its preview slice.
  const [showAllTagChips, setShowAllTagChips] = useState(false);
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
  // Live mirror so the freshness poll can tell the viewer is open without taking
  // lightboxIndex as a dep (it changes on every slideshow step — that would
  // restart the poll interval each frame). Never auto-prepend under an open
  // viewer: it would shift the indices out from under the current slide.
  const lightboxOpenRef = useRef(false);
  const fetchGen = useRef(0);
  const fetchController = useRef<AbortController | null>(null);
  useEffect(() => {
    lightboxOpenRef.current = lightboxIndex !== null;
  }, [lightboxIndex]);

  // Deep link: a `?view=<imageId>` in the address opens the viewer on that image
  // once results load, so a copied URL returns to the same picture. Captured on
  // init and consumed by the effect below; cleared from the URL on close/refetch.
  const pendingViewRef = useRef<string | null>(null);
  const syncViewUrl = useCallback((item: { imageId: string } | null) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (item) url.searchParams.set("view", item.imageId);
    else url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", url);
  }, []);

  // Pagination depth in the address: `?page=N` records how many pages are
  // currently stacked in the grid, so a copied / refreshed URL re-pages to the
  // same accumulated window (consumed by the init effect below). Page 1 is the
  // bare state, so it drops the param. replaceState — no router churn.
  const syncPageUrl = useCallback((page: number) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (page > 1) url.searchParams.set("page", String(page));
    else url.searchParams.delete("page");
    window.history.replaceState(window.history.state, "", url);
  }, []);

  // Bulk selection + actions. In select mode a card click toggles selection
  // instead of opening the viewer. "Export details" downloads each picked
  // image's canonical catalog record as JSON; "Delete selected" un-indexes each
  // (catalog + search + graph), leaving the originals on disk.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  // Which bulk action is mid-flight (favorite/rating/safety/tags/export/delete),
  // and a transient success line for actions with no visible card change.
  const [bulkBusy, setBulkBusy] = useState<BulkBusy>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // System
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [folderPath, setFolderPath] = useState("");
  const [showIngest, setShowIngest] = useState(false);

  // Stable ref for current filter values — lets doFetch() always read fresh state
  // even when called from callbacks that close over an older render.
  const filtersRef = useRef({
    mode, query, tags, excludeTags, modelFamily, checkpoint, loras, sourceTool,
    pathFilter, favorites, minRating, safety, limit, minScore, similarRef, imageFile, graphScope,
    sort: settings.sortMode,
  });
  useEffect(() => {
    filtersRef.current = {
      mode, query, tags, excludeTags, modelFamily, checkpoint, loras, sourceTool,
      pathFilter, favorites, minRating, safety, limit, minScore, similarRef, imageFile, graphScope,
      sort: settings.sortMode,
    };
  });

  // One page fetch for a filter snapshot at a given offset. Builds the right
  // request for the active path (similar / by-image / browse / search) and
  // returns the rows plus whether more pages exist. Both the rendered fetch
  // (doFetch) and the background prefetcher go through here, so the request shape
  // lives in exactly one place. `note` is only produced by the by-image path.
  const fetchPage = useCallback(
    async (
      s: typeof filtersRef.current,
      pageOffset: number,
      signal: AbortSignal,
    ): Promise<{ fresh: CompactResult[]; more: boolean; note?: string }> => {
      const pageSize = s.limit;
      const safetySubset =
        s.safety.length > 0 && s.safety.length < SAFETY_CLASSES.length ? s.safety : undefined;
      const ratingGte = s.minRating > 0 ? s.minRating : undefined;
      const loraList = csv(s.loras);
      const filters = {
        tags: s.tags.length ? s.tags : undefined,
        excludeTags: s.excludeTags.length ? s.excludeTags : undefined,
        modelFamily: s.modelFamily.trim() || undefined,
        checkpoint: s.checkpoint.trim() || undefined,
        loras: loraList.length ? loraList : undefined,
        sourceTool: s.sourceTool.trim() || undefined,
        favorite: s.favorites || undefined,
        ratingGte,
        // Only send a safety filter when a strict subset is selected; all (or
        // none) selected means "no filter" so unclassified images stay visible.
        safety: safetySubset,
      };

      if (s.mode === "similar" && s.similarRef) {
        const r = await fetch("/api/library/search/similar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ imageId: s.similarRef.id, filters, limit: pageSize, offset: pageOffset, minScore: s.minScore, graphScope: s.graphScope ?? undefined }),
          signal,
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Similarity search failed");
        return { fresh: j.results ?? [], more: j.hasMore ?? false };
      }
      if (s.mode === "image" && s.imageFile) {
        const fd = new FormData();
        fd.append("file", s.imageFile);
        fd.append("options", JSON.stringify({ filters, limit: pageSize, minScore: s.minScore, graphScope: s.graphScope ?? undefined }));
        const r = await fetch("/api/library/search/by-image", { method: "POST", body: fd, signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Image search failed");
        const note = j.semantic
          ? `Visual similarity · ${j.provider}`
          : "Visual similarity · local color/layout features (CLIP not configured)";
        return { fresh: j.results ?? [], more: false, note };
      }
      if (isBrowsePath(s.mode, s.query)) {
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
            path: s.pathFilter.trim() || undefined,
            sort: browseSort,
            limit: pageSize,
            offset: pageOffset,
          }),
          signal,
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Browse failed");
        const fresh: CompactResult[] = j.results ?? [];
        return { fresh, more: j.hasMore ?? fresh.length === pageSize };
      }
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
        signal,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Search failed");
      const fresh: CompactResult[] = j.results ?? [];
      return { fresh, more: fresh.length === pageSize };
    },
    [],
  );

  // --- Background page prefetch -------------------------------------------
  // Warm the next PREFETCH_AHEAD pages so the next "load more" / scroll renders
  // with no spinner. Keyed by a signature of the active filters: a filter change
  // discards stale pages. Only the offset-paged paths use it (see `paginates`).
  const prefetchRef = useRef<{
    sig: string;
    pages: Map<number, { fresh: CompactResult[]; more: boolean }>;
    inFlight: Set<number>;
    controllers: AbortController[];
    exhausted: boolean; // a fetched page came back short — no pages beyond it
  }>({ sig: "", pages: new Map(), inFlight: new Set(), controllers: [], exhausted: false });

  const prefetchSig = (s: typeof filtersRef.current): string =>
    JSON.stringify({
      mode: s.mode, query: s.query, tags: s.tags, excludeTags: s.excludeTags,
      modelFamily: s.modelFamily, checkpoint: s.checkpoint, loras: s.loras, sourceTool: s.sourceTool,
      pathFilter: s.pathFilter,
      favorites: s.favorites, minRating: s.minRating, safety: s.safety, limit: s.limit,
      minScore: s.minScore, similar: s.similarRef?.id ?? null, image: !!s.imageFile,
      graphScope: s.graphScope, sort: s.sort,
    });

  // by-image returns a single relevance-ranked window (no offset), so there are
  // no further pages to warm. Similar now pages by rank offset like browse/search.
  const paginates = (s: typeof filtersRef.current): boolean =>
    !(s.mode === "image" && s.imageFile);

  // Abort outstanding prefetches and rebind the buffer to a new filter signature.
  const resetPrefetch = useCallback((s: typeof filtersRef.current) => {
    prefetchRef.current.controllers.forEach((c) => c.abort());
    prefetchRef.current = {
      sig: prefetchSig(s), pages: new Map(), inFlight: new Set(), controllers: [], exhausted: false,
    };
  }, []);

  // Drop buffered pages but keep the signature — used when the freshness poll
  // splices new rows at the head and shifts every offset out from under them.
  const invalidatePrefetchPages = useCallback(() => {
    const pf = prefetchRef.current;
    pf.controllers.forEach((c) => c.abort());
    pf.pages.clear();
    pf.inFlight.clear();
    pf.controllers = [];
    pf.exhausted = false;
  }, []);

  // Pull a warmed page if it matches the current filters; consuming removes it
  // so a shifted offset can't re-serve it.
  const takePrefetched = useCallback((s: typeof filtersRef.current, pageIndex: number) => {
    const pf = prefetchRef.current;
    if (pf.sig !== prefetchSig(s)) return null;
    const hit = pf.pages.get(pageIndex);
    if (hit) pf.pages.delete(pageIndex);
    return hit ?? null;
  }, []);

  // Warm up to PREFETCH_AHEAD pages beyond what's loaded. Sequential so we stop
  // the moment a short page reveals the end. Fire-and-forget.
  const schedulePrefetch = useCallback(
    (s: typeof filtersRef.current) => {
      if (!paginates(s)) return;
      const pf = prefetchRef.current;
      if (pf.sig !== prefetchSig(s) || pf.exhausted) return;
      const pageSize = s.limit;
      const start = pageRef.current; // index of the next not-yet-loaded page
      void (async () => {
        for (let i = 0; i < PREFETCH_AHEAD; i++) {
          const idx = start + i;
          if (pf.exhausted || pf.pages.has(idx) || pf.inFlight.has(idx)) continue;
          pf.inFlight.add(idx);
          const controller = new AbortController();
          pf.controllers.push(controller);
          try {
            const res = await fetchPage(s, idx * pageSize, controller.signal);
            if (prefetchRef.current.sig !== pf.sig) return; // filters changed mid-flight
            pf.pages.set(idx, { fresh: res.fresh, more: res.more });
            if (!res.more) pf.exhausted = true;
          } catch {
            // ignore — the page will just be fetched on demand
          } finally {
            pf.inFlight.delete(idx);
          }
        }
      })();
    },
    [fetchPage],
  );

  const doFetch = useCallback(
    async (append: boolean, overrides?: Partial<typeof filtersRef.current>) => {
      const s = { ...filtersRef.current, ...overrides };

      // Cancel any in-flight request and mark this call as the current generation
      // so stale callbacks can detect they've been superseded.
      fetchController.current?.abort();
      const gen = ++fetchGen.current;
      const controller = new AbortController();
      fetchController.current = controller;
      const { signal } = controller;

      // A fresh search invalidates the open viewer (its indices no longer map)
      // and any pending bulk selection (those ids may not be in the new set).
      // It also re-baselines the freshness poll: whatever we load now becomes
      // the "seen" head, so the New-images banner only fires on later arrivals.
      if (!append) {
        setLightboxIndex(null);
        // The viewer's image is no longer in this result set — drop it from the
        // URL too (kept stable via history.replaceState, no router churn).
        if (typeof window !== "undefined") {
          const u = new URL(window.location.href);
          if (u.searchParams.has("view")) {
            u.searchParams.delete("view");
            window.history.replaceState(window.history.state, "", u);
          }
        }
        setSelected(new Set());
        setConfirmingBulk(false);
        setHasNew(false);
        newestIdRef.current = null;
        resetPrefetch(s); // new filter set — discard warmed pages
      }

      // Image mode with no image yet: nothing to search.
      if (s.mode === "image" && !s.imageFile) {
        setResults([]);
        setHasMore(false);
        setLoading(false);
        syncPageUrl(1);
        return;
      }

      setLoading(true);
      setError(null);

      const pageSize = s.limit;
      const pageOffset = append ? pageRef.current * pageSize : 0;

      try {
        // On append, consume a warmed page if we have one (instant); otherwise
        // fetch it. The next page's index equals the current loaded-page count.
        const buffered = append ? takePrefetched(s, pageRef.current) : null;
        const { fresh, more, note } = buffered
          ? { note: undefined as string | undefined, ...buffered }
          : await fetchPage(s, pageOffset, signal);
        if (note !== undefined) setImageNote(note);

        // A newer call superseded this one while we were awaiting — discard.
        if (fetchGen.current !== gen) return;

        if (append) {
          pageRef.current += 1;
          // Drop any id already on screen. Offset paging can re-emit a boundary
          // row when the underlying set shifts between page fetches (an ingest
          // lands mid-scroll); a repeated id would collide as a React key.
          setResults((prev) => {
            const seen = new Set(prev.map((r) => r.imageId));
            return [...prev, ...fresh.filter((r) => !seen.has(r.imageId))];
          });
        } else {
          pageRef.current = 1;
          setResults(fresh);
          // Baseline the freshness poll so it only fires for images that arrive
          // AFTER this load — no redundant probe on the next poll tick.
          newestIdRef.current = fresh[0]?.imageId ?? null;
        }
        setHasMore(more);
        // Record the new depth in the address and warm the pages beyond it.
        syncPageUrl(pageRef.current);
        schedulePrefetch(s);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        if (fetchGen.current !== gen) return;
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        // Only the current generation should clear the loading spinner.
        if (fetchGen.current === gen) setLoading(false);
      }
    },
    [fetchPage, resetPrefetch, takePrefetched, schedulePrefetch, syncPageUrl],
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

  // Toggle one image's selection. Also flips the grid into select mode, so a
  // Ctrl/Cmd+click on a card starts a selection without first hitting "Select".
  const toggleSelect = useCallback((id: string) => {
    setSelectMode(true);
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
    setBulkBusy("delete");
    setError(null);
    setNotice(null);
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
      setBulkBusy(null);
    }
  }, [selected, exitSelectMode]);

  // Fan a metadata edit out over the selected rows. `build` produces the PATCH
  // body per row (so tag add/remove can compute a per-image final list); `patch`
  // mirrors that change onto the loaded grid row so the cards update without a
  // refetch. Partial failures surface inline; the rest still apply.
  const applyBulk = useCallback(
    async (
      kind: Exclude<NonNullable<BulkBusy>, "export" | "delete">,
      build: (r: CompactResult) => ImagePatchBody,
      patch: (r: CompactResult) => CompactResult,
      summary: (ok: number, total: number) => string,
    ) => {
      const rows = results.filter((r) => selected.has(r.imageId));
      if (rows.length === 0) return;
      setBulkBusy(kind);
      setError(null);
      setNotice(null);
      try {
        const { updated, failed } = await patchImages(
          rows.map((r) => ({ id: r.imageId, body: build(r) })),
        );
        if (updated.length > 0) {
          const ok = new Set(updated);
          setResults((prev) => prev.map((r) => (ok.has(r.imageId) ? patch(r) : r)));
        }
        if (failed.length > 0) {
          setError(`${summary(updated.length, rows.length)} ${failed.length} failed: ${failed[0].error}`);
        } else {
          setNotice(summary(updated.length, rows.length));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Bulk action failed");
      } finally {
        setBulkBusy(null);
      }
    },
    [results, selected],
  );

  const bulkFavorite = useCallback(
    (fav: boolean) =>
      applyBulk(
        "favorite",
        () => ({ favorite: fav }),
        (r) => r, // favorite isn't shown on the card; no local mirror needed
        (ok, total) => `${fav ? "Favorited" : "Unfavorited"} ${ok}/${total}.`,
      ),
    [applyBulk],
  );

  const bulkRating = useCallback(
    (rating: number) => {
      const value = rating === 0 ? null : rating;
      return applyBulk(
        "rating",
        () => ({ rating: value }),
        (r) => ({ ...r, rating: value }),
        (ok, total) => `${value === null ? "Cleared rating on" : `Set ${rating}★ on`} ${ok}/${total}.`,
      );
    },
    [applyBulk],
  );

  const bulkSafety = useCallback(
    (value: SafetyClass) =>
      applyBulk(
        "safety",
        () => ({ safety: value }),
        (r) => ({ ...r, safety: value }),
        (ok, total) => `Set ${SAFETY_LABEL[value]} on ${ok}/${total}.`,
      ),
    [applyBulk],
  );

  const bulkAddTags = useCallback(
    (add: string[]) => {
      const merge = (r: CompactResult) => Array.from(new Set([...r.tags, ...add]));
      return applyBulk(
        "tags",
        (r) => ({ tags: merge(r) }),
        (r) => ({ ...r, tags: merge(r) }),
        (ok, total) => `Added ${add.length} tag${add.length === 1 ? "" : "s"} to ${ok}/${total}.`,
      );
    },
    [applyBulk],
  );

  const bulkRemoveTags = useCallback(
    (remove: string[]) => {
      const rm = new Set(remove);
      const strip = (r: CompactResult) => r.tags.filter((t) => !rm.has(t));
      return applyBulk(
        "tags",
        (r) => ({ tags: strip(r) }),
        (r) => ({ ...r, tags: strip(r) }),
        (ok, total) => `Removed ${remove.length} tag${remove.length === 1 ? "" : "s"} from ${ok}/${total}.`,
      );
    },
    [applyBulk],
  );

  // Export every selected image's catalog record. The server route fans the
  // gateway detail reads out and reports partial failures, which surface inline;
  // whatever resolved still downloads. `complete-*` dump the full canonical
  // record; `simple-*` project it to the basics (id · sha · path · …) and add a
  // spreadsheet-friendly CSV.
  const exportSelected = useCallback(async (kind: ExportKind) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy("export");
    setError(null);
    setNotice(null);
    try {
      const result = await exportImages(ids);
      if (result.count > 0) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const base = `deedlit-export-${result.count}-images-${stamp}`;
        const simple = () => result.images.map(toSimpleRecord);
        switch (kind) {
          // Complete JSON keeps the export wrapper (meta + errors); JSONL is the
          // bare records, one per line.
          case "complete-json":
            downloadJson(result, `${base}.json`);
            break;
          case "complete-jsonl":
            downloadJsonl(result.images, `${base}.jsonl`);
            break;
          case "simple-json":
            downloadJson(
              { exportedAt: result.exportedAt, count: result.count, images: simple() },
              `${base}-simple.json`,
            );
            break;
          case "simple-jsonl":
            downloadJsonl(simple(), `${base}-simple.jsonl`);
            break;
          case "simple-csv":
            downloadCsv(simple(), `${base}-simple.csv`);
            break;
        }
      }
      const label = kind.startsWith("simple") ? "simple" : "complete";
      if (result.errors.length > 0) {
        setError(
          `Exported ${result.count}/${ids.length}. ${result.errors.length} failed: ${result.errors[0].error}`,
        );
      } else {
        setNotice(`Exported ${result.count} image${result.count === 1 ? "" : "s"} (${label}).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBulkBusy(null);
    }
  }, [selected]);

  const bulkMove = useCallback(async (targetFolder: string) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy("move");
    setError(null);
    setNotice(null);
    try {
      const { moved, failed } = await moveImages(ids, targetFolder);
      if (moved.length > 0) {
        setNotice(`Moved ${moved.length}/${ids.length} file${moved.length === 1 ? "" : "s"} to ${targetFolder}.`);
      }
      if (failed.length > 0) {
        setError(
          `Moved ${moved.length}/${ids.length}. ${failed.length} failed: ${failed[0].error}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Move failed");
    } finally {
      setBulkBusy(null);
    }
  }, [selected]);

  // Rate a single image from the lightbox. Updates the grid row immediately so
  // the card reflects the change without a refetch.
  const rateImage = useCallback(async (imageId: string, rating: number | null) => {
    try {
      const res = await fetch(`/api/library/images/${encodeURIComponent(imageId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      if (res.ok) {
        setResults((prev) =>
          prev.map((r) => (r.imageId === imageId ? { ...r, rating } : r)),
        );
      }
    } catch {
      // silent — non-critical
    }
  }, []);

  const fetchNotesForImage = useCallback(async (imageId: string) => {
    try {
      const r = await fetch(`/api/library/notes/by-image/${encodeURIComponent(imageId)}`);
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }, []);

  const createNoteForImage = useCallback(async (imageId: string, text: string) => {
    await fetch("/api/library/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: text, blocks: {}, imageRefs: [imageId] }),
    });
  }, []);

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

  // Ingest-job polling (independent of saved settings). System health lives on
  // its own page (/admin/health, self-polling ServiceStatusBoard).
  useEffect(() => {
    if (!showIngest) return;
    const pollJobs = () =>
      fetch("/api/library/jobs")
        .then((r) => r.json())
        .then((j) => { if (j.jobs) setJobs(j.jobs); })
        .catch(() => {});
    pollJobs();
    const id = setInterval(pollJobs, 3000);
    return () => clearInterval(id);
  }, [showIngest]);

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
    pendingViewRef.current = sp.get("view"); // opened once results land (below)
    const wantImage = qpMode === "image" || (!qpMode && settings.defaultMode === "image");
    const initialMode: BrowseMode = wantImage ? "image" : "browse";
    // Restore how deep the user had paged (`?page=N`) so the address returns to
    // the same accumulated window. Capped — a cold restore costs N sequential
    // page fetches. By-image can't be restored (its file isn't in the URL).
    const wantPages = wantImage
      ? 1
      : Math.min(Math.max(1, Math.floor(Number(sp.get("page")) || 1)), MAX_RESTORE_PAGES);

    if (qpTags.length) setTags(qpTags);
    if (qpQuery) setQuery(qpQuery);
    if (wantImage) setShowImageSearch(true);
    setMode(initialMode);
    setFavorites(settings.defaultFavoritesOnly);
    setMinRating(settings.defaultMinRating);
    setMinScore(settings.defaultMinScore);
    setSafety(settings.defaultSafety);
    setLimit(settings.pageSize);
    // State setters above don't reach filtersRef before this runs, so pass the
    // full snapshot as overrides — to the initial load AND every restore page.
    const overrides = {
      mode: initialMode,
      tags: qpTags,
      query: qpQuery,
      favorites: settings.defaultFavoritesOnly,
      minRating: settings.defaultMinRating,
      minScore: settings.defaultMinScore,
      safety: settings.defaultSafety,
      limit: settings.pageSize,
      similarRef: null,
      imageFile: null,
    } as const;
    void (async () => {
      await doFetch(false, overrides);
      // Re-page up to the saved depth. Each step consumes a prefetched page when
      // one is warm, so the restore mostly skips the network after the first.
      for (let i = 1; i < wantPages; i++) {
        await doFetch(true, overrides);
      }
    })();
  }, [hydrated, settings, doFetch]);

  // Infinite scroll: prefetch the next page well before the sentinel is visible.
  // The lookahead scales with viewport height (~1.5 screens) so on tall/ultrawide
  // displays the next page lands before the user ever reaches the end of the grid.
  useEffect(() => {
    if (!settings.infiniteScroll || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const lookahead = Math.round((typeof window !== "undefined" ? window.innerHeight : 800) * 1.5);
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) loadMore();
      },
      { rootMargin: `${lookahead}px 0px` },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [settings.infiniteScroll, hasMore, loading, loadMore]);

  // Freshness poll: while filter-only browsing, watch the newest catalog head for
  // the current filter set. Only runs on the browse path — search results are a
  // point-in-time ranking, not a live feed.
  //
  // When the grid is sorted newest-first and the user is parked at the top with no
  // viewer open, new arrivals are spliced straight into the grid (no click). Any
  // other case — a different sort, scrolled down, viewer open — keeps the gentle
  // "New images — refresh" banner instead, so the scroll position never jumps out
  // from under the user. `relevance` maps to newest on the browse path, so it
  // counts as newest-first here too.
  useEffect(() => {
    if (!isBrowsePath(mode, query)) {
      setHasNew(false);
      return;
    }
    const safetySubset =
      safety.length > 0 && safety.length < SAFETY_CLASSES.length ? safety : undefined;
    // Only a newest-first grid can correctly receive arrivals at the head; for
    // other sorts new rows belong elsewhere, so we just detect + banner.
    const newestFirst = settings.sortMode === "newest" || settings.sortMode === "relevance";
    const body = {
      tags: tags.length ? tags : undefined,
      excludeTags: excludeTags.length ? excludeTags : undefined,
      favorite: favorites || undefined,
      ratingGte: minRating > 0 ? minRating : undefined,
      safety: safetySubset,
      path: pathFilter.trim() || undefined,
      sort: "newest" as const,
      // Pull a small window when we may splice (catch a short burst of arrivals);
      // a single row is enough just to detect change for the banner path.
      limit: newestFirst ? 12 : 1,
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
        const rows: CompactResult[] = j.results ?? [];
        const topId = rows[0]?.imageId ?? null;
        if (!alive || !topId) return;
        if (newestIdRef.current === null) {
          newestIdRef.current = topId; // baseline whatever's at the head now
          return;
        }
        if (topId === newestIdRef.current) return; // nothing new

        const canSplice =
          newestFirst && !lightboxOpenRef.current && window.scrollY < 200;
        if (canSplice) {
          setResults((prev) => {
            const seen = new Set(prev.map((p) => p.imageId));
            const incoming = rows.filter((p) => !seen.has(p.imageId));
            return incoming.length ? [...incoming, ...prev] : prev;
          });
          newestIdRef.current = topId;
          setHasNew(false);
          // Head rows shifted every deeper offset — drop warmed pages; the next
          // load-more re-fetches and re-warms from the new boundary.
          invalidatePrefetchPages();
        } else {
          setHasNew(true); // surface the banner; refresh re-pages from the top
        }
      } catch {
        // transient — try again next tick
      }
    };
    const id = setInterval(check, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mode, query, tags, excludeTags, favorites, minRating, safety, pathFilter, settings.sortMode, invalidatePrefetchPages]);

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

  // Live, library-wide tag autocomplete for the filter pickers: prefix-match
  // ranked by usage, served by /api/library/tags (-> gateway -> catalog). An
  // empty prefix returns the most-used tags. Failures go quiet (empty list).
  const fetchTagSuggestions = useCallback(async (q: string): Promise<string[]> => {
    try {
      const r = await fetch(`/api/library/tags?prefix=${encodeURIComponent(q)}&limit=10`);
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j.tags) ? (j.tags as string[]) : [];
    } catch {
      return [];
    }
  }, []);

  // Whole tag catalog for the primary filter's "show all tags" picker (ranked
  // most-used first). Fetched once on mount; the picker lists every tag and the
  // input just narrows the list client-side, instead of a blind type-ahead.
  useEffect(() => {
    let alive = true;
    fetch("/api/library/tags?limit=2000")
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((j) => { if (alive && Array.isArray(j.tags)) setAllTags(j.tags as string[]); })
      .catch(() => { /* quiet — the picker just stays empty */ });
    return () => { alive = false; };
  }, []);

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

  // Consume a `?view=` deep link: once results are in, open the viewer on the
  // matching image. The window grows page-by-page during a `?page=N` restore, so
  // keep looking as it fills; only give up (one shot) once everything is loaded
  // and it still isn't here — we don't chase pages beyond the restored depth.
  useEffect(() => {
    const want = pendingViewRef.current;
    if (!want || displayResults.length === 0) return;
    const i = displayResults.findIndex((r) => r.imageId === want);
    if (i !== -1) {
      pendingViewRef.current = null;
      openLightbox(i);
    } else if (!loading && !hasMore) {
      pendingViewRef.current = null; // fully loaded and absent — abandon
    }
  }, [displayResults, openLightbox, loading, hasMore]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-ui-2xl font-semibold text-ui-ink-title">Image Library</h1>
          <p className="text-ui-sm text-ui-ink-muted">
            {results.length > 0
              ? `${results.length}${hasMore ? "+" : ""} images`
              : "Browse, search & curate your generated images"}
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
            title="Select multiple images for bulk actions (or Ctrl/Cmd+click a card)"
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

          {/* Primary filter: shows the WHOLE tag catalog to pick from (ranked
              most-used first); typing just narrows the list. Adding / removing a
              chip re-searches instantly (cheap server filter). Falls back to the
              live prefix type-ahead until the catalog has loaded. */}
          <TagSelect
            value={tags}
            onChange={setTags}
            onCommit={(next) => doFetch(false, { tags: next })}
            suggestions={allTags}
            fetchSuggestions={allTags.length ? undefined : fetchTagSuggestions}
            maxSuggestions={500}
            placeholder="filter by tag — pick from the list, or type to narrow…"
            variant="include"
          />

          {/* Always-visible selectable tag cloud: the most-used tags as one-click
              include chips (no need to open the picker or type). Clicking a chip
              toggles it in the include filter and re-searches; selected chips glow.
              "+N more" expands to the whole catalog. */}
          {allTags.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-ui-2xs font-medium uppercase tracking-wide text-ui-ink-muted">
                Popular tags
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(showAllTagChips ? allTags : allTags.slice(0, TAG_CHIP_PREVIEW)).map((t) => {
                  const on = tags.some((x) => x.toLowerCase() === t.toLowerCase());
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = on
                          ? tags.filter((x) => x.toLowerCase() !== t.toLowerCase())
                          : [...tags, t];
                        setTags(next);
                        doFetch(false, { tags: next });
                      }}
                      className={`rounded-full border px-2.5 py-1 text-ui-2xs font-medium transition ${
                        on
                          ? "border-accent-cyan bg-accent-cyan/15 text-accent-cyan"
                          : "border-ui-border/60 text-ui-ink-muted hover:border-accent-cyan/60 hover:text-ui-ink"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
                {allTags.length > TAG_CHIP_PREVIEW && (
                  <button
                    type="button"
                    onClick={() => setShowAllTagChips((v) => !v)}
                    className="rounded-full px-2.5 py-1 text-ui-2xs font-medium text-accent-cyan/80 transition hover:text-accent-cyan"
                  >
                    {showAllTagChips ? "show less" : `+${allTags.length - TAG_CHIP_PREVIEW} more`}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Essentials row: favorites + rating + safety. Everything else (model,
              checkpoint, LoRA, source-tool, exclude-tags, limits) lives under
              Advanced so the common case stays uncluttered. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
              aria-label="Minimum rating"
            >
              <option value={0}>Any rating</option>
              <option value={1}>★+</option>
              <option value={2}>★★+</option>
              <option value={3}>★★★+</option>
              <option value={4}>★★★★+</option>
              <option value={5}>★★★★★</option>
            </select>

            {/* Content-safety filter — multi-select chips. All on = no filter
                (everything, incl. unclassified); a subset shows only those classes. */}
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
                Tags, rating, favorite, safety & path filter plain browsing too.
                Model, checkpoint, LoRA & source-tool apply when a text or image
                search is active.
              </p>
              <label className={`${cls.label} col-span-full`}>
                Path contains
                <input
                  className={cls.input}
                  placeholder="folder or filename fragment — e.g. 2024/portraits or _upscaled"
                  value={pathFilter}
                  onChange={(e) => setPathFilter(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doFetch(false, { pathFilter: e.currentTarget.value })}
                />
                <span className="text-ui-2xs normal-case tracking-normal text-ui-ink-muted/70">
                  matches the on-disk image path (any separator); applies to plain browsing
                </span>
              </label>
              <label className={cls.label}>
                Exclude tags
                <TagSelect
                  value={excludeTags}
                  onChange={setExcludeTags}
                  onCommit={(next) => doFetch(false, { excludeTags: next })}
                  fetchSuggestions={fetchTagSuggestions}
                  placeholder="tags to hide…"
                  variant="exclude"
                />
              </label>
              <label className={cls.label}>
                Model family
                <input
                  className={cls.input}
                  placeholder="sdxl, pony, flux…"
                  value={modelFamily}
                  onChange={(e) => setModelFamily(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
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

      {/* Bulk-selection action bar */}
      {selectMode && results.length > 0 && (
        <div className="flex flex-col gap-1">
          <BulkActionBar
            selectedCount={selected.size}
            totalCount={results.length}
            busy={bulkBusy}
            confirmingDelete={confirmingBulk}
            onSelectAll={() => setSelected(new Set(results.map((r) => r.imageId)))}
            onClear={clearSelection}
            onFavorite={bulkFavorite}
            onRating={bulkRating}
            onSafety={bulkSafety}
            onAddTags={bulkAddTags}
            onRemoveTags={bulkRemoveTags}
            onExport={exportSelected}
            onMove={bulkMove}
            onRequestDelete={() => setConfirmingBulk(true)}
            onConfirmDelete={deleteSelected}
            onCancelDelete={() => setConfirmingBulk(false)}
            fetchTagSuggestions={fetchTagSuggestions}
          />
          {notice && <p className="px-1 text-ui-xs text-emerald-500">{notice}</p>}
        </div>
      )}

      {results.length > 0 && (
        <Gallery
          items={displayResults}
          getKey={(r) => r.imageId}
          viewMode={settings.viewMode}
          gridClassName={`grid ${gridColumnsClass(settings.gridDensity)} gap-3`}
          masonryClassName={`${masonryColumnsClass(settings.gridDensity)} gap-3`}
          cardClassName={
            settings.viewMode === "list"
              ? "rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 p-2 transition hover:border-accent-cyan"
              : "overflow-hidden rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 transition hover:border-accent-cyan"
          }
          mediaClassName={selectMode ? "cursor-pointer" : "cursor-zoom-in"}
          getHref={(r) => `/library/${r.imageId}`}
          onOpen={(i) => openLightbox(i)}
          selectMode={selectMode}
          isSelected={(r) => selected.has(r.imageId)}
          onToggleSelect={(r) => toggleSelect(r.imageId)}
          selectOnCtrlClick
          renderMedia={(r, ctx) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.thumbnailUrl}
              alt={r.summary}
              loading="lazy"
              className={
                ctx.viewMode === "list"
                  ? "h-16 w-16 rounded-lg object-cover sm:h-20 sm:w-20"
                  : ctx.viewMode === "masonry"
                    ? "w-full object-cover"
                    : "aspect-square w-full object-cover"
              }
            />
          )}
          renderMeta={(r, ctx) => {
            if (ctx.viewMode === "list") {
              return (
                <>
                  <a
                    href={`/library/${r.imageId}`}
                    onClick={(e) => {
                      if (ctx.selectMode) {
                        e.preventDefault();
                        ctx.open();
                        return;
                      }
                      // Ctrl/Cmd+click selects (mirrors the media click); other
                      // modified / middle clicks open the detail page normally.
                      if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        ctx.toggleSelect();
                        return;
                      }
                      if (e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault();
                      ctx.open();
                    }}
                    className={`block ${ctx.selectMode ? "cursor-pointer" : "cursor-zoom-in"}`}
                  >
                    <p className="line-clamp-2 text-ui-sm text-ui-ink">{r.summary}</p>
                  </a>
                  {settings.showCardMeta && <CardMeta r={r} showScores={settings.showScores} />}
                </>
              );
            }
            if (!settings.showCardMeta) return null;
            return (
              <div className="p-2">
                <p className="line-clamp-2 text-ui-xs text-ui-ink">{r.summary}</p>
                <CardMeta r={r} showScores={settings.showScores} />
              </div>
            );
          }}
          renderOverlay={(r) => (
            <button
              onClick={() => findSimilar(r.imageId, r.thumbnailUrl, r.summary)}
              className="rounded-md border border-ui-border/50 bg-ui-bg/90 px-2 py-1 text-ui-2xs font-medium text-ui-ink backdrop-blur-sm transition hover:border-accent-cyan hover:bg-accent-cyan hover:text-ui-bg-deep"
              title="Find similar images"
            >
              Similar
            </button>
          )}
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
          onCurrentChange={syncViewUrl}
          onClose={() => {
            setLightboxIndex(null);
            syncViewUrl(null);
          }}
          onSimilar={(it) => {
            setLightboxIndex(null);
            syncViewUrl(null);
            findSimilar(it.imageId, it.thumbnailUrl, it.summary);
          }}
          onToggleFullResolution={() =>
            setKey("viewerFullResolution", !settings.viewerFullResolution)
          }
          onRating={rateImage}
          fetchNotes={fetchNotesForImage}
          onCreateNote={createNoteForImage}
        />
      )}
    </div>
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
