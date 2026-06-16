"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/** Minimal shape the lightbox needs from a search result. */
export interface LightboxItem {
  imageId: string;
  thumbnailUrl: string;
  summary: string;
  score?: number | null;
}

export interface SlideshowSettings {
  /** Seconds between auto-advances. */
  interval: number;
  loop: boolean;
  shuffle: boolean;
}

interface LightboxProps {
  items: LightboxItem[];
  initialIndex: number;
  /** Stream the full-resolution original instead of the thumbnail. */
  fullResolution: boolean;
  slideshow: SlideshowSettings;
  /** Start the slideshow playing as soon as the viewer opens. */
  autoPlay?: boolean;
  /** More results can be loaded (drives auto-load near the end of the strip). */
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onClose: () => void;
  onSimilar?: (item: LightboxItem) => void;
  onToggleFullResolution?: () => void;
  /** Fires whenever the displayed image changes — drives URL sync. */
  onCurrentChange?: (item: LightboxItem) => void;
}

const ctrlBtn =
  "grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ui-border/50 bg-ui-bg/70 text-ui-ink-muted backdrop-blur transition hover:border-accent-cyan hover:text-accent-cyan disabled:cursor-not-allowed disabled:opacity-40";

const navBtn =
  "group absolute top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-ui-border/40 bg-ui-bg/60 text-ui-ink backdrop-blur transition hover:border-accent-cyan hover:bg-ui-bg/90 hover:text-accent-cyan disabled:opacity-30";

function bigSrc(item: LightboxItem, full: boolean): string {
  return full
    ? `/api/library/images/${item.imageId}/file`
    : `/api/library/images/${item.imageId}/thumbnail`;
}

/**
 * Fullscreen image viewer that pages through the current result list.
 *
 * Keyboard: ← / → navigate, Space toggles the slideshow, Home / End jump to the
 * ends, Esc closes. As you approach the end of the loaded results (and there are
 * more) it transparently pulls the next page so a long list never dead-ends.
 */
export function Lightbox({
  items,
  initialIndex,
  fullResolution,
  slideshow,
  autoPlay = false,
  hasMore,
  loadingMore,
  onLoadMore,
  onClose,
  onSimilar,
  onToggleFullResolution,
  onCurrentChange,
}: LightboxProps) {
  // Track the displayed image by *id*, not by position. The result list can
  // reorder, grow (load-more) or have rows spliced under the viewer; an index
  // would then point at a different picture. The id keeps the same image on
  // screen and we re-derive its index each render.
  const [currentId, setCurrentId] = useState<string | null>(
    () => items[initialIndex]?.imageId ?? items[0]?.imageId ?? null,
  );
  const [playing, setPlaying] = useState(autoPlay);
  const [imgLoaded, setImgLoaded] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  // Resolve the live position of the tracked image each render. If it vanished
  // (the list changed under us) land on the original open slot, clamped — a rare
  // safety net; `go()` reads this resolved index so navigation continues cleanly.
  const found = items.findIndex((it) => it.imageId === currentId);
  const index =
    found !== -1
      ? found
      : Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1));
  const current = items[index];

  // Latest values for the slideshow timer, which closes over its first render.
  const live = useRef({ index, items, hasMore, slideshow, currentId });
  useEffect(() => {
    live.current = { index, items, hasMore, slideshow, currentId };
  });

  // Jump to a position by resolving it to the image id that lives there.
  const goToIndex = useCallback((i: number) => {
    const list = live.current.items;
    const it = list[Math.max(0, Math.min(i, list.length - 1))];
    if (it) setCurrentId(it.imageId);
  }, []);

  const go = useCallback(
    (dir: 1 | -1) => {
      const { items: list, hasMore: more, slideshow: ss, currentId: cid } = live.current;
      if (list.length === 0) return;
      let i = list.findIndex((it) => it.imageId === cid);
      if (i === -1) i = Math.min(live.current.index, list.length - 1);

      if (dir === 1 && ss.shuffle && playing) {
        setCurrentId(list[Math.floor(Math.random() * list.length)].imageId);
        return;
      }
      const next = i + dir;
      if (next < 0) {
        setCurrentId(list[ss.loop ? list.length - 1 : 0].imageId);
        return;
      }
      if (next >= list.length) {
        if (more) {
          onLoadMore(); // stay put; the next tick advances once results grow
          return;
        }
        if (ss.loop) {
          setCurrentId(list[0].imageId);
          return;
        }
        setPlaying(false); // reached the end of a non-looping run
        return;
      }
      setCurrentId(list[next].imageId);
    },
    [onLoadMore, playing],
  );

  // Slideshow timer.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => go(1), Math.max(1, slideshow.interval) * 1000);
    return () => clearInterval(id);
  }, [playing, slideshow.interval, go]);

  // Pull more results as we approach the end so navigation never dead-ends.
  useEffect(() => {
    if (hasMore && !loadingMore && index >= items.length - 3) onLoadMore();
  }, [index, hasMore, loadingMore, items.length, onLoadMore]);

  // Report the displayed image to the parent (URL sync) — only when it changes,
  // not on every slideshow-timer render, so we don't thrash history state.
  const onCurrentChangeRef = useRef(onCurrentChange);
  useEffect(() => {
    onCurrentChangeRef.current = onCurrentChange;
  });
  useEffect(() => {
    if (current) onCurrentChangeRef.current?.(current);
  }, [current?.imageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the load state whenever the displayed image changes.
  useEffect(() => {
    setImgLoaded(false);
  }, [current?.imageId, fullResolution]);

  // Preload the neighbours for smooth stepping / slideshow.
  useEffect(() => {
    [index + 1, index - 1].forEach((i) => {
      const it = items[i];
      if (it) {
        const im = new window.Image();
        im.src = bigSrc(it, fullResolution);
      }
    });
  }, [index, items, fullResolution]);

  // Keep the active filmstrip thumbnail in view.
  useEffect(() => {
    stripRef.current
      ?.querySelector(`[data-idx="${index}"]`)
      ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          go(1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          go(-1);
          break;
        case " ":
          e.preventDefault();
          setPlaying((p) => !p);
          break;
        case "Home":
          e.preventDefault();
          goToIndex(0);
          break;
        case "End":
          e.preventDefault();
          goToIndex(live.current.items.length - 1);
          break;
        case "Escape":
          onClose();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, goToIndex, onClose]);

  if (!current) return null;

  const atStart = index === 0 && !slideshow.loop;
  const atEnd = index === items.length - 1 && !slideshow.loop && !hasMore;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      className="fixed inset-0 z-100 flex flex-col bg-ui-bg-deep/95 backdrop-blur-md"
    >
      {/* Top control bar */}
      <header className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 rounded-lg bg-ui-bg/60 px-2 py-1 text-ui-xs font-medium tabular-nums text-ui-ink-muted">
            {index + 1} / {items.length}
            {hasMore ? "+" : ""}
          </span>
          <p className="hidden min-w-0 truncate text-ui-sm text-ui-ink-muted sm:block">
            {current.summary}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className={`${ctrlBtn} ${playing ? "border-accent-cyan text-accent-cyan" : ""}`}
            aria-pressed={playing}
            title={playing ? "Pause slideshow (Space)" : "Play slideshow (Space)"}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {onToggleFullResolution && (
            <button
              type="button"
              onClick={onToggleFullResolution}
              className={`${ctrlBtn} w-auto px-2 text-ui-2xs font-semibold ${fullResolution ? "border-accent-cyan text-accent-cyan" : ""}`}
              aria-pressed={fullResolution}
              title={fullResolution ? "Showing HD original — switch to thumbnail" : "Showing thumbnail — switch to HD original"}
            >
              HD
            </button>
          )}

          {onSimilar && (
            <button
              type="button"
              onClick={() => onSimilar(current)}
              className={`${ctrlBtn} w-auto gap-1.5 px-2 text-ui-2xs font-medium`}
              title="Find similar images"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              Similar
            </button>
          )}

          <Link
            href={`/library/${current.imageId}`}
            prefetch={false}
            className={`${ctrlBtn} w-auto gap-1.5 px-2 text-ui-2xs font-medium`}
            title="Open full details"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            Details
          </Link>

          <button type="button" onClick={onClose} className={ctrlBtn} title="Close (Esc)">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      {/* Stage — click the empty area to close */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={atStart}
          aria-label="Previous image"
          className={`${navBtn} left-2 sm:left-4`}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>

        {!imgLoaded && (
          <div className="absolute inset-0 m-auto h-8 w-8 animate-pulse rounded-full border-2 border-ui-border/50 border-t-accent-cyan" aria-hidden="true" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current.imageId + (fullResolution ? "-hd" : "")}
          src={bigSrc(current, fullResolution)}
          alt={current.summary}
          onLoad={() => setImgLoaded(true)}
          className={`max-h-full max-w-full object-contain transition-opacity duration-200 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
        />

        {/* Quality indicator — what's actually on screen right now. */}
        <span
          className={`pointer-events-none absolute bottom-3 left-3 rounded-md border px-2 py-1 text-ui-2xs font-semibold backdrop-blur ${
            fullResolution
              ? "border-accent-cyan bg-ui-bg/80 text-accent-cyan"
              : "border-ui-border/50 bg-ui-bg/70 text-ui-ink-muted"
          }`}
        >
          {fullResolution ? "HD · original" : "Thumbnail"}
        </span>

        {typeof current.score === "number" && current.score > 0 && (
          <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-ui-bg/80 px-2.5 py-1 font-mono text-ui-2xs text-accent-cyan backdrop-blur">
            score {current.score.toFixed(3)}
          </span>
        )}

        <button
          type="button"
          onClick={() => go(1)}
          disabled={atEnd}
          aria-label="Next image"
          className={`${navBtn} right-2 sm:right-4`}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Filmstrip — horizontally scrollable, never wraps */}
      <div
        ref={stripRef}
        className="flex shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-t border-ui-border/40 bg-ui-bg/40 px-3 py-2.5"
      >
        {items.map((it, i) => (
          <button
            key={it.imageId}
            data-idx={i}
            type="button"
            onClick={() => setCurrentId(it.imageId)}
            aria-label={`Go to image ${i + 1}`}
            aria-current={i === index}
            className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md border transition ${
              i === index
                ? "border-accent-cyan ring-2 ring-accent-cyan/40"
                : "border-ui-border/50 opacity-70 hover:opacity-100"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="grid h-14 w-14 shrink-0 place-items-center rounded-md border border-dashed border-ui-border/60 text-ui-2xs text-ui-ink-muted transition hover:border-accent-cyan hover:text-accent-cyan disabled:opacity-50"
          >
            {loadingMore ? "…" : "More"}
          </button>
        )}
      </div>
    </div>
  );
}
