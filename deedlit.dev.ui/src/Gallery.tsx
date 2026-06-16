"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "./utils";

export type GalleryViewMode = "grid" | "masonry" | "list";

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
}: GalleryProps<T>) {
  const list = viewMode === "list";
  const masonry = viewMode === "masonry";

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
    <div className={cn(containerClass, className)}>
      {items.map((item, index) => {
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
    </div>
  );
}

export default Gallery;
