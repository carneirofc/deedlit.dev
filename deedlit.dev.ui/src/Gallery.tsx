"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "./utils";

export type GalleryViewMode = "grid" | "masonry" | "list";

/** Tuning for the always-on sliding window (see {@link GalleryProps.windowing}).
 *  `pageSize` is the fetch-page row count and `pages` how many pages stay mounted
 *  (default 5 — the current page plus two each side); both are optional and only
 *  refine the window so it tracks the caller's real fetch pages. */
export interface GalleryWindowing {
  pageSize?: number;
  pages?: number;
}

// The window is ALWAYS active: only a window of items around the viewport is
// mounted so a large gallery never jams the page (the rest are spacers that hold
// the scroll height). It no-ops on its own when there are fewer than a window's
// worth of items. These defaults apply when the caller passes no `windowing`.
const DEFAULT_WINDOW_PAGES = 5;
const DEFAULT_WINDOW_PAGE_SIZE = 60;

/** Per-item context handed to every render slot. */
export interface GalleryItemContext {
  index: number;
  viewMode: GalleryViewMode;
  selected: boolean;
  selectMode: boolean;
  /** Open this item — in select mode this toggles selection instead. */
  open: () => void;
  /** Toggle this item's selection regardless of mode (for Ctrl/Cmd+click). */
  toggleSelect: () => void;
}

export interface GalleryProps<T> {
  items: T[];
  /** Stable React key (and identity) per item. */
  getKey: (item: T) => string;
  viewMode?: GalleryViewMode;
  /** Container class for the grid view (apps own their column scheme / density). */
  gridClassName?: string;
  /** Container class for the masonry view (e.g. CSS columns). */
  masonryClassName?: string;
  /** Container class for the list view. */
  listClassName?: string;
  /** Primary (unmodified) click on an item's media. */
  onOpen?: (index: number, item: T) => void;
  /** When set, the media is an anchor so modified/middle clicks open in a new tab. */
  getHref?: (item: T) => string | undefined;
  /** Multi-select (optional). */
  selectMode?: boolean;
  isSelected?: (item: T) => boolean;
  onToggleSelect?: (item: T) => void;
  /**
   * When set, a Ctrl/Cmd+click on an item toggles its selection (instead of
   * opening it / following the link) even when not already in select mode — the
   * app is expected to enter select mode off the resulting onToggleSelect.
   */
  selectOnCtrlClick?: boolean;
  /** The thumbnail / image. */
  renderMedia: (item: T, ctx: GalleryItemContext) => ReactNode;
  /** Caption / meta rendered after the media (grid/masonry) or beside it (list). */
  renderMeta?: (item: T, ctx: GalleryItemContext) => ReactNode;
  /** Hover actions — top-right in grid/masonry, row-end in list. */
  renderOverlay?: (item: T, ctx: GalleryItemContext) => ReactNode;
  /** Theming for the item wrapper; apps pass their own chrome (border/bg/padding). */
  cardClassName?: string;
  /** Extra classes when an item is selected. */
  selectedClassName?: string;
  /** Classes for the clickable media wrapper (e.g. cursor affordance). */
  mediaClassName?: string;
  className?: string;
  /** Optional tuning for the always-on sliding window. The window is built in
   *  (bounded DOM for large result sets) — this only refines its size so it
   *  tracks the caller's real fetch pages; omit it to use the defaults. */
  windowing?: GalleryWindowing;
}

const DEFAULT_SELECTED = "border-accent-cyan ring-2 ring-accent-cyan";

/** Left-click opens; modified clicks (Ctrl/Cmd/Shift/Alt/middle) fall through. */
function isPlainClick(e: React.MouseEvent): boolean {
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
}

/** Checkbox overlay shown on each card/row while in select mode. */
function SelectCheck({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded border transition",
        checked
          ? "border-accent-cyan bg-accent-cyan text-ui-bg-deep"
          : "border-ui-border/80 bg-ui-bg/80 text-transparent backdrop-blur-sm",
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5 9-11" />
      </svg>
    </span>
  );
}

/**
 * Generic, presentation-only media grid. Owns layout (grid / masonry / list),
 * the selection checkbox + ring, and click semantics (open vs. toggle-select,
 * with modified clicks falling through to a real link when `getHref` is given).
 * Everything domain-specific — what the thumbnail, caption and hover actions
 * look like — is supplied by the caller through render slots, so the component
 * carries no app data shape and no framework image dependency.
 */
export function Gallery<T>({
  items,
  getKey,
  viewMode = "grid",
  gridClassName = "grid gap-3",
  masonryClassName = "gap-3",
  listClassName = "flex flex-col gap-2",
  onOpen,
  getHref,
  selectMode = false,
  isSelected,
  onToggleSelect,
  selectOnCtrlClick = false,
  renderMedia,
  renderMeta,
  renderOverlay,
  cardClassName,
  selectedClassName = DEFAULT_SELECTED,
  mediaClassName,
  className,
  windowing,
}: GalleryProps<T>) {
  const list = viewMode === "list";
  const masonry = viewMode === "masonry";

  // --- Sliding window (always on) -----------------------------------------
  // Only a contiguous window of items around the viewport is mounted; everything
  // above/below is collapsed into a spacer that holds the scroll height. The
  // window keeps ~2 pages above and below whatever's on screen (5 pages total by
  // default), so paging arbitrarily deep never grows the DOM — which is what
  // jammed the grid once enough pages had accumulated. It engages automatically
  // once there are more items than fit one window, and is a no-op below that.
  const windowPages = windowing?.pages ?? DEFAULT_WINDOW_PAGES;
  const pageSize = windowing?.pageSize ?? DEFAULT_WINDOW_PAGE_SIZE;
  const windowCount = windowPages * pageSize;
  const behindCount = Math.floor((windowPages - 1) / 2) * pageSize;
  // Masonry flows column-major (CSS multi-column), so a contiguous index slice
  // does NOT map to a vertical band of the viewport the way it does for a
  // row-major grid/list — windowing it strands blank columns as you scroll. The
  // window keys off row-major geometry, so it only engages for grid/list; masonry
  // renders every item (its variable heights already keep the DOM modest).
  const enabled = !masonry && items.length > windowCount;

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Live grid geometry (columns + per-row pixel stride) measured from the DOM, so
  // spacer heights stay exact for the windowed grid / list views without us
  // hard-coding any column scheme.
  const geomRef = useRef<{ cols: number; rowH: number }>({ cols: 1, rowH: 0 });
  const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const prevFirstKey = useRef<string | null>(null);

  const firstKey = items.length ? getKey(items[0]) : "";

  // Re-derive the window from the current scroll position. Reads geometry fresh
  // from the rendered cards each time (cards carry their absolute index), so it
  // works for any column count / density and self-corrects after a resize.
  const recompute = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (items.length <= windowCount) {
      setRange((prev) =>
        prev.start === 0 && prev.end === items.length ? prev : { start: 0, end: items.length },
      );
      return;
    }
    const cards = el.querySelectorAll<HTMLElement>("[data-gallery-item]");
    if (cards.length === 0) return;
    const rects = Array.from(cards, (c) => c.getBoundingClientRect());
    const first = rects[0];

    // Columns = the number of distinct left edges among the mounted cards (the
    // grid's column count; 1 for the list view). Rounded to swallow sub-pixel
    // drift. This reads geometry directly, so it self-corrects after a resize.
    const cols = Math.max(1, new Set(rects.map((r) => Math.round(r.left))).size);

    // Per-row vertical stride, averaged over every mounted row rather than read
    // from the first pair. That stays exact for a uniform grid and robust when
    // rows differ in height (wrapped captions / mixed media), where a single-pair
    // measure would drift. Clamped to >= 1 so a not-yet-laid-out grid (all cards
    // still zero-height) can never divide by zero and strand the window.
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const rowsMounted = Math.max(1, Math.ceil(rects.length / cols));
    const rowH = Math.max(1, (bottom - first.top) / rowsMounted);
    geomRef.current = { cols, rowH };

    // The first mounted card sits at viewport-Y `first.top`, so `-first.top`
    // pixels of grid lie above the viewport — that many rows of stride gives the
    // first item on screen. (No `window.scrollY` term: `first.top` is already
    // relative to the viewport, so it encodes the scroll offset on its own.)
    const firstIdx = Number(cards[0].dataset.index) || 0;
    const rowsAbove = Math.round(-first.top / rowH);
    const viewportFirst = Math.max(0, firstIdx + rowsAbove * cols);
    let start = viewportFirst - behindCount;
    start = Math.max(0, Math.min(start, items.length - windowCount));
    start -= start % cols; // align to a full row so the top spacer is exact
    const end = Math.min(items.length, start + windowCount);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [items.length, windowCount, behindCount]);

  // rAF-coalesced recompute: many scroll / resize / mutation signals collapse to
  // one measure per frame. Shared by the scroll + resize listeners, the resize
  // observer, and the re-anchor path so they can't stack redundant work.
  const rafRef = useRef(0);
  const scheduleRecompute = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      recompute();
    });
  }, [recompute]);
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // A new result set (or a head splice that changes the first item) re-anchors the
  // window to the top; otherwise re-derive it from scroll. Layout effect so the
  // window + spacers are right before paint (no flash, no premature load-more).
  useLayoutEffect(() => {
    if (!enabled) {
      setRange((prev) =>
        prev.start === 0 && prev.end === items.length ? prev : { start: 0, end: items.length },
      );
      prevFirstKey.current = firstKey;
      return;
    }
    if (firstKey !== prevFirstKey.current) {
      prevFirstKey.current = firstKey;
      setRange({ start: 0, end: Math.min(items.length, windowCount) });
      // A remount or head splice can commit with the page already scrolled down
      // (browser scroll restoration on nav). Re-derive from the real scroll next
      // frame so the window tracks the viewport instead of staying at the top
      // showing a blank spacer.
      scheduleRecompute();
      return;
    }
    recompute();
  }, [enabled, firstKey, items.length, windowCount, viewMode, recompute, scheduleRecompute]);

  // Follow the scroll while windowed (rAF-coalesced), re-derive on viewport
  // resize, and — via a ResizeObserver on the grid — whenever the grid's own
  // height changes (cards growing as their images decode, captions wrapping, a
  // column-count breakpoint). Without the observer the window could stay parked
  // over stale geometry, mounting a slice that no longer overlaps the viewport.
  // The mount-time call honours a scroll position already in place at mount
  // (nav restore) even if no scroll event ever fires.
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    window.addEventListener("scroll", scheduleRecompute, { passive: true });
    window.addEventListener("resize", scheduleRecompute);
    const ro =
      el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleRecompute) : null;
    ro?.observe(el as Element);
    scheduleRecompute();
    return () => {
      window.removeEventListener("scroll", scheduleRecompute);
      window.removeEventListener("resize", scheduleRecompute);
      ro?.disconnect();
    };
  }, [enabled, scheduleRecompute]);

  // The slice to mount + the spacer heights for the collapsed remainder. Before
  // the first measure (range.end === 0) fall back to the leading window so the
  // first paint is never blank.
  const winStart = enabled ? range.start : 0;
  const winEnd = enabled
    ? range.end > range.start
      ? range.end
      : Math.min(items.length, windowCount)
    : items.length;
  const sliceItems = enabled ? items.slice(winStart, winEnd) : items;
  const { cols, rowH } = geomRef.current;
  const topSpacer = enabled && rowH > 0 ? Math.floor(winStart / cols) * rowH : 0;
  const bottomSpacer =
    enabled && rowH > 0 ? Math.ceil(Math.max(0, items.length - winEnd) / cols) * rowH : 0;

  // A spacer must span every column so it offsets the grid/masonry as one block
  // rather than occupying a single cell.
  const spacer = (key: string, height: number): ReactNode =>
    height > 0 ? (
      <div
        key={key}
        aria-hidden="true"
        data-gallery-spacer=""
        style={
          list
            ? { height }
            : masonry
              ? { height, columnSpan: "all" }
              : { height, gridColumn: "1 / -1" }
        }
      />
    ) : null;

  // While `selectOnCtrlClick` is on and we're not already in select mode, a held
  // Ctrl/Cmd "arms" selection: the next click toggles select instead of opening.
  // Track the key so the grid can advertise it — pointer cursor + a select check
  // hint + a hover ring — so the user sees a card is clickable-to-select before
  // committing the click. Window blur clears it (a missed keyup loses the state).
  const [ctrlDown, setCtrlDown] = useState(false);
  const armed = selectOnCtrlClick && !selectMode && ctrlDown;
  useEffect(() => {
    if (!selectOnCtrlClick || selectMode) {
      setCtrlDown(false);
      return;
    }
    const sync = (e: KeyboardEvent) => setCtrlDown(e.ctrlKey || e.metaKey);
    const clear = () => setCtrlDown(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, [selectOnCtrlClick, selectMode]);

  const containerClass = list
    ? listClassName
    : masonry
      ? masonryClassName
      : gridClassName;

  return (
    <div ref={containerRef} className={cn(containerClass, className)}>
      {spacer("__top", topSpacer)}
      {sliceItems.map((item, i) => {
        const index = winStart + i;
        const selected = isSelected?.(item) ?? false;
        const href = getHref?.(item);
        const ctx: GalleryItemContext = {
          index,
          viewMode,
          selected,
          selectMode,
          open: () => (selectMode ? onToggleSelect?.(item) : onOpen?.(index, item)),
          toggleSelect: () => onToggleSelect?.(item),
        };

        // Ctrl/Cmd+click selects the item (the app enters select mode off this)
        // rather than opening it or following the link in a new tab.
        const isCtrlSelect = (e: React.MouseEvent) =>
          selectOnCtrlClick && !!onToggleSelect && (e.ctrlKey || e.metaKey);

        const onMediaClick = (e: React.MouseEvent) => {
          if (selectMode) {
            e.preventDefault();
            onToggleSelect?.(item);
            return;
          }
          if (isCtrlSelect(e)) {
            e.preventDefault();
            onToggleSelect?.(item);
            return;
          }
          if (href && !isPlainClick(e)) return; // let the browser open the link
          e.preventDefault();
          onOpen?.(index, item);
        };

        const mediaInner = renderMedia(item, ctx);
        // When armed (Ctrl/Cmd held, not yet in select mode) advertise the click:
        // pointer cursor + a hover hint. `cursor-pointer` is last so twMerge wins
        // over the app's cursor-zoom-in.
        const armTitle = armed ? "Ctrl/Cmd-click to select" : undefined;
        const media = href ? (
          <a href={href} onClick={onMediaClick} title={armTitle} className={cn("block", list && "shrink-0", mediaClassName, armed && "cursor-pointer")}>
            {mediaInner}
          </a>
        ) : (
          <button type="button" onClick={onMediaClick} title={armTitle} className={cn("block text-left", list && "shrink-0", mediaClassName, armed && "cursor-pointer")}>
            {mediaInner}
          </button>
        );

        // Unchecked select-check shown while armed, as a "this will select" cue.
        const armHint = armed ? (
          <span
            className={cn(
              "pointer-events-none z-10 opacity-70 transition-opacity group-hover:opacity-100",
              list ? "shrink-0" : "absolute left-1.5 top-1.5",
            )}
            aria-hidden="true"
          >
            <SelectCheck checked={false} />
          </span>
        ) : null;

        const check = selectMode ? (
          <button
            type="button"
            onClick={() => onToggleSelect?.(item)}
            aria-pressed={selected}
            aria-label={selected ? "Deselect" : "Select"}
            className={list ? "shrink-0" : "absolute left-1.5 top-1.5 z-10"}
          >
            <SelectCheck checked={selected} />
          </button>
        ) : null;

        if (list) {
          return (
            <div
              key={getKey(item)}
              data-gallery-item=""
              data-index={index}
              className={cn(
                "group flex items-center gap-3",
                cardClassName,
                selected && selectedClassName,
                armed && "ring-1 ring-accent-cyan/30 hover:ring-2 hover:ring-accent-cyan/70",
              )}
            >
              {check}
              {armHint}
              {media}
              {renderMeta && <div className="min-w-0 flex-1">{renderMeta(item, ctx)}</div>}
              {!selectMode && renderOverlay && (
                <div className="shrink-0">{renderOverlay(item, ctx)}</div>
              )}
            </div>
          );
        }

        return (
          <div
            key={getKey(item)}
            data-gallery-item=""
            data-index={index}
            className={cn(
              "group relative",
              masonry && "mb-3 break-inside-avoid",
              cardClassName,
              selected && selectedClassName,
              armed && "ring-1 ring-accent-cyan/30 hover:ring-2 hover:ring-accent-cyan/70",
            )}
          >
            {media}
            {check}
            {armHint}
            {!selectMode && renderOverlay && (
              <div className="pointer-events-none absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                {renderOverlay(item, ctx)}
              </div>
            )}
            {renderMeta?.(item, ctx)}
          </div>
        );
      })}
      {spacer("__bottom", bottomSpacer)}
    </div>
  );
}

export default Gallery;
