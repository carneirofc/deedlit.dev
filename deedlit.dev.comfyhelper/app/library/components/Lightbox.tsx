"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

interface ImageDetail {
  id: string;
  filename: string;
  filePath: string;
  prompt: string | null;
  negativePrompt: string | null;
  rating: number | null;
  favorite: boolean;
  model: string | null;
  checkpoint: string | null;
  modelFamily: string | null;
  width: number | null;
  height: number | null;
  sourceTool: string | null;
  tags: { name: string; normalizedName: string; source?: string | null }[];
  loras: { name: string; weight: number | null }[];
  generationParams: Record<string, unknown> | null;
  descriptions: { id: string; description: string; provider: string | null }[];
}

/** Minimal shape the lightbox needs from a search result. */
export interface LightboxItem {
  imageId: string;
  thumbnailUrl: string;
  summary: string;
  score?: number | null;
  rating?: number | null;
}

interface LightboxNote {
  id: string;
  title?: string | null;
  created_at?: string;
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
  /** Called when user rates the current image (null clears the rating). */
  onRating?: (imageId: string, rating: number | null) => void;
  /** Fetch notes for a given imageId. */
  fetchNotes?: (imageId: string) => Promise<LightboxNote[]>;
  /** Create a plain-text note attached to an image. */
  onCreateNote?: (imageId: string, text: string) => Promise<void>;
  /** Un-index the current image (catalog + search + graph; original kept on
   * disk). Resolves once it's gone so the viewer can advance off it. */
  onDelete?: (imageId: string) => Promise<void>;
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
  onRating,
  fetchNotes,
  onCreateNote,
  onDelete,
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
  // Root element for the native Fullscreen API + whether we're currently in it.
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Touch-swipe tracking for mobile navigation across the image stage.
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // Notes panel state
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState<LightboxNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  // Inline details panel state
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detail, setDetail] = useState<ImageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Delete confirmation — a two-step click so the destructive action is never a
  // single misclick away.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  // Fetch notes for the current image when the notes panel is open.
  useEffect(() => {
    if (!notesOpen || !fetchNotes || !current) return;
    let alive = true;
    setNotesLoading(true);
    fetchNotes(current.imageId)
      .then((n) => { if (alive) setNotes(n); })
      .catch(() => {})
      .finally(() => { if (alive) setNotesLoading(false); });
    return () => { alive = false; };
  }, [notesOpen, current?.imageId, fetchNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset notes + any pending delete confirmation when navigating to a new
  // image (stale data / a primed confirm from the old one).
  useEffect(() => {
    setNotes([]);
    setNoteDraft("");
    setConfirmingDelete(false);
  }, [current?.imageId]);

  // Fetch image detail when the details panel is open or the image changes.
  useEffect(() => {
    if (!detailsOpen || !current) return;
    let alive = true;
    setDetailLoading(true);
    setDetail(null);
    fetch(`/api/library/images/${current.imageId}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setDetail(j); })
      .catch(() => {})
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [detailsOpen, current?.imageId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Native fullscreen — fills the physical screen (hides browser chrome on
  // mobile), which is what a slideshow wants. Toggle from the button or "f".
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void el.requestFullscreen?.().catch(() => {});
    }
  }, []);

  // Mirror the real fullscreen state (covers Esc-exit and OS-level changes).
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Leave fullscreen when the viewer unmounts so the page isn't left zoomed.
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen?.();
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
        case "f":
        case "F":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "Escape":
          // In fullscreen, let the browser reclaim Esc to exit it; only close
          // the viewer on a second Esc once we're back to the windowed overlay.
          if (document.fullscreenElement) return;
          onClose();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, goToIndex, onClose, toggleFullscreen]);

  // Un-index the current image, then land on a neighbour so the viewer keeps
  // flowing — next image if there is one, else the previous, else close when the
  // last picture is removed. The neighbour id is captured before deletion so it
  // survives the list shrinking underneath us.
  const handleDelete = useCallback(async () => {
    const cur = live.current;
    const list = cur.items;
    const i = cur.index;
    const victim = list[i];
    if (!onDelete || !victim || deleting) return;
    const neighbour = list[i + 1] ?? list[i - 1] ?? null;
    setDeleting(true);
    try {
      await onDelete(victim.imageId);
      setConfirmingDelete(false);
      if (neighbour) setCurrentId(neighbour.imageId);
      else onClose();
    } finally {
      setDeleting(false);
    }
  }, [onDelete, deleting, onClose]);

  if (!current) return null;

  const atStart = index === 0 && !slideshow.loop;
  const atEnd = index === items.length - 1 && !slideshow.loop && !hasMore;

  // Windowed filmstrip: only a band of thumbnails around the active index is
  // mounted; the rest collapse into left/right spacers that hold the scroll
  // width. A deep result set (hundreds/thousands of rows) otherwise mounted an
  // <img> per item here — that froze the viewer. The active thumb is always
  // inside the band, so the scrollIntoView centring still finds it.
  const STRIP_HALF = 40;
  const STRIP_STRIDE = 64; // w-14 (56px) + gap-2 (8px)
  const stripStart = Math.max(0, index - STRIP_HALF);
  const stripEnd = Math.min(items.length, index + STRIP_HALF);
  const stripLead = stripStart * STRIP_STRIDE;
  const stripTail = (items.length - stripEnd) * STRIP_STRIDE;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      className="fixed inset-0 z-100 flex flex-col bg-ui-bg-deep/95 backdrop-blur-md"
    >
      {/* Top control bar */}
      <header className="flex items-start justify-between gap-3 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 shrink-0 items-center gap-3 pt-1">
          <span className="shrink-0 rounded-lg bg-ui-bg/60 px-2 py-1 text-ui-xs font-medium tabular-nums text-ui-ink-muted">
            {index + 1} / {items.length}
            {hasMore ? "+" : ""}
          </span>
          <p className="hidden min-w-0 truncate text-ui-sm text-ui-ink-muted lg:block">
            {current.summary}
          </p>
        </div>

        {/* Controls wrap onto a second row on narrow screens instead of squishing. */}
        <div className="flex flex-wrap items-center justify-end gap-1.5">
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

          <button
            type="button"
            onClick={toggleFullscreen}
            className={`${ctrlBtn} ${isFullscreen ? "border-accent-cyan text-accent-cyan" : ""}`}
            aria-pressed={isFullscreen}
            title={isFullscreen ? "Exit fullscreen (F)" : "Enter fullscreen (F)"}
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 3v3a3 3 0 0 1-3 3H3M21 9h-3a3 3 0 0 1-3-3V3M3 15h3a3 3 0 0 1 3 3v3M15 21v-3a3 3 0 0 1 3-3h3" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M16 21h3a2 2 0 0 0 2-2v-3M8 21H5a2 2 0 0 1-2-2v-3" />
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

          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className={`${ctrlBtn} w-auto gap-1.5 px-2 text-ui-2xs font-medium ${detailsOpen ? "border-accent-cyan text-accent-cyan" : ""}`}
            aria-pressed={detailsOpen}
            title="Toggle details panel"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            Details
          </button>
          <Link
            href={`/library/${current.imageId}`}
            prefetch={false}
            className={`${ctrlBtn} text-ui-2xs`}
            title="Open full details page"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </Link>

          {/* Star rating */}
          {onRating && (
            <div className="flex h-9 items-center gap-0.5" role="group" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onRating(current.imageId, current.rating === n ? null : n)}
                  className={`text-base leading-none transition ${
                    n <= (current.rating ?? 0)
                      ? "text-amber-400 hover:text-amber-300"
                      : "text-ui-ink-muted/30 hover:text-amber-400/70"
                  }`}
                  title={`${n}★${current.rating === n ? " — click to clear" : ""}`}
                  aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
                >
                  ★
                </button>
              ))}
            </div>
          )}

          {/* Notes toggle */}
          {fetchNotes && (
            <button
              type="button"
              onClick={() => setNotesOpen((v) => !v)}
              className={`${ctrlBtn} w-auto gap-1.5 px-2 text-ui-2xs font-medium ${notesOpen ? "border-accent-cyan text-accent-cyan" : ""}`}
              aria-pressed={notesOpen}
              title="Toggle notes panel"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
              </svg>
              Notes{notes.length > 0 ? ` (${notes.length})` : ""}
            </button>
          )}

          {/* Delete (un-index) — two-step: the first click primes a rose confirm
              button, the second removes the image and advances the viewer. */}
          {onDelete &&
            (confirmingDelete ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="grid h-9 w-auto place-items-center gap-1.5 rounded-lg bg-rose-500/90 px-2.5 text-ui-2xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60"
                  title="Remove this image from the library (original kept on disk)"
                >
                  {deleting ? "Removing…" : "Delete?"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className={ctrlBtn}
                  title="Cancel"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className={`${ctrlBtn} hover:border-rose-500/70 hover:text-rose-400`}
                title="Delete this image from the library"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
              </button>
            ))}

          <button type="button" onClick={onClose} className={ctrlBtn} title="Close (Esc)">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      {/* Notes panel */}
      {notesOpen && fetchNotes && (
        <div className="flex max-h-48 flex-col gap-2 overflow-y-auto border-b border-ui-border/40 bg-ui-bg/70 px-4 py-3 backdrop-blur-sm">
          {notesLoading ? (
            <p className="text-ui-xs text-ui-ink-muted">Loading notes…</p>
          ) : notes.length === 0 ? (
            <p className="text-ui-xs text-ui-ink-muted">No notes yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg border border-ui-border/40 bg-ui-bg/60 px-3 py-2">
                  <p className="text-ui-xs text-ui-ink">{n.title ?? "(empty note)"}</p>
                  {n.created_at && (
                    <p className="mt-0.5 text-ui-2xs text-ui-ink-muted/60">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {onCreateNote && (
            <div className="flex gap-2 pt-1">
              <input
                className="flex-1 rounded-lg border border-ui-border/70 bg-ui-bg px-3 py-1.5 text-ui-xs outline-none focus:border-accent-cyan"
                placeholder="Add a note…"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && noteDraft.trim() && !noteSaving) {
                    setNoteSaving(true);
                    try {
                      await onCreateNote(current.imageId, noteDraft.trim());
                      setNoteDraft("");
                      const refreshed = await fetchNotes(current.imageId);
                      setNotes(refreshed);
                    } finally {
                      setNoteSaving(false);
                    }
                  }
                }}
                disabled={noteSaving}
              />
              <button
                className="rounded-lg border border-ui-border/70 bg-ui-bg-soft px-3 py-1.5 text-ui-xs font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50"
                disabled={!noteDraft.trim() || noteSaving}
                onClick={async () => {
                  if (!noteDraft.trim() || noteSaving) return;
                  setNoteSaving(true);
                  try {
                    await onCreateNote(current.imageId, noteDraft.trim());
                    setNoteDraft("");
                    const refreshed = await fetchNotes(current.imageId);
                    setNotes(refreshed);
                  } finally {
                    setNoteSaving(false);
                  }
                }}
              >
                {noteSaving ? "…" : "Add"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stage — details panel + image area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

      {/* Inline details panel */}
      {detailsOpen && (
        <aside className="flex w-[min(20rem,80vw)] shrink-0 flex-col gap-3 overflow-x-hidden overflow-y-auto border-r border-ui-border/40 bg-ui-bg/85 p-4 backdrop-blur-sm sm:w-96">
          {detailLoading && <p className="text-ui-xs text-ui-ink-muted">Loading…</p>}
          {detail && <LightboxDetailPanel detail={detail} imageId={current.imageId} />}
        </aside>
      )}

      {/* Click the empty area to close; swipe horizontally to page (mobile). */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          touchStart.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const s = touchStart.current;
          touchStart.current = null;
          if (!s) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          // Horizontal fling: dominant-axis + min distance, so taps and vertical
          // scrolls don't trigger navigation.
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            go(dx < 0 ? 1 : -1);
          }
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
          decoding="async"
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
      </div>

      {/* Filmstrip — horizontally scrollable, never wraps */}
      <div
        ref={stripRef}
        className="flex shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-t border-ui-border/40 bg-ui-bg/40 px-3 py-2.5"
      >
        {stripLead > 0 && (
          <div aria-hidden="true" className="shrink-0" style={{ width: stripLead }} />
        )}
        {items.slice(stripStart, stripEnd).map((it, j) => {
          const i = stripStart + j;
          return (
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
          );
        })}
        {stripTail > 0 && (
          <div aria-hidden="true" className="shrink-0" style={{ width: stripTail }} />
        )}
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

function LightboxDetailPanel({ detail, imageId }: { detail: ImageDetail; imageId: string }) {
  const sec = "border-t border-ui-border/40 pt-3 mt-3";
  const label = "text-ui-2xs font-medium uppercase tracking-wide text-ui-ink-muted mb-1";
  return (
    <div className="flex flex-col text-ui-xs text-ui-ink">
      <p className="break-all font-medium text-ui-ink-title">{detail.filename}</p>

      <dl className={`${sec} grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui-ink-muted`}>
        {detail.model && <><dt>Model</dt><dd className="break-words text-ui-ink">{detail.model}</dd></>}
        {detail.modelFamily && <><dt>Family</dt><dd className="break-words text-ui-ink">{detail.modelFamily}</dd></>}
        {detail.checkpoint && <><dt>Checkpoint</dt><dd className="break-words text-ui-ink">{detail.checkpoint}</dd></>}
        {detail.sourceTool && <><dt>Source</dt><dd className="break-words text-ui-ink">{detail.sourceTool}</dd></>}
        {(detail.width || detail.height) && <><dt>Size</dt><dd className="text-ui-ink">{detail.width}×{detail.height}</dd></>}
      </dl>

      {detail.filePath && (
        <div className={sec}>
          <p className={label}>File path</p>
          <p className="break-all font-mono text-ui-2xs text-ui-ink-muted">{detail.filePath}</p>
        </div>
      )}

      {detail.tags.length > 0 && (
        <div className={sec}>
          <p className={label}>Tags</p>
          <div className="flex flex-wrap gap-1">
            {detail.tags.map((t) => (
              <Link
                key={`${t.normalizedName}-${t.source}`}
                href={`/library?tags=${encodeURIComponent(t.normalizedName || t.name)}`}
                prefetch={false}
                className="rounded-full bg-ui-bg px-2 py-0.5 text-ui-2xs text-ui-ink-muted transition hover:text-accent-cyan"
              >
                {t.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {detail.prompt && (
        <div className={sec}>
          <p className={label}>Prompt</p>
          <p className="line-clamp-6 whitespace-pre-wrap text-ui-2xs text-ui-ink">{detail.prompt}</p>
        </div>
      )}

      {detail.negativePrompt && (
        <div className={sec}>
          <p className={label}>Negative prompt</p>
          <p className="line-clamp-4 whitespace-pre-wrap text-ui-2xs text-ui-ink-muted">{detail.negativePrompt}</p>
        </div>
      )}

      {detail.loras.length > 0 && (
        <div className={sec}>
          <p className={label}>LoRAs</p>
          <ul className="flex flex-col gap-0.5">
            {detail.loras.map((l) => (
              <li key={l.name} className="text-ui-2xs text-ui-ink-muted">
                {l.name}{l.weight != null ? ` (${l.weight})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.descriptions.length > 0 && (
        <div className={sec}>
          <p className={label}>AI description</p>
          {detail.descriptions.map((d) => (
            <p key={d.id} className="line-clamp-4 text-ui-2xs text-ui-ink">{d.description}</p>
          ))}
        </div>
      )}

      <div className={sec}>
        <Link
          href={`/library/${imageId}`}
          prefetch={false}
          className="inline-flex items-center gap-1 text-ui-2xs text-accent-cyan hover:underline"
        >
          Open full details
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
