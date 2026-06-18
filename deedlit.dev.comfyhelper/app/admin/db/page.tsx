"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { deleteImages } from "@/lib/library/bulk-delete";

// ---------------------------------------------------------------------------
// DB power-user / debug page (#30, ADR 0001).
//
// Browse/filter the catalog (Postgres) TRUTH, inspect the raw stored JSON
// (params / workflow_json / api_prompt_json), edit curated fields in place, and
// trigger per-image ops (re-index / re-label / delete-everywhere). Projection
// stores (Neo4j/Qdrant) are not edited here — they're rebuilt from truth.
// ---------------------------------------------------------------------------

const cls = {
  card: "rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 p-4",
  input:
    "w-full rounded-lg border border-ui-border/70 bg-ui-bg px-3 py-2 text-ui-sm outline-none focus:border-accent-cyan",
  btn: "rounded-lg border border-ui-border/70 bg-ui-bg-soft px-3 py-2 text-ui-sm font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50",
  danger:
    "rounded-md border border-rose-500/40 px-2 py-1 text-ui-xs text-rose-500 transition hover:bg-rose-500/10",
};

const SAFETY = ["", "sfw", "nsfw", "explicit"] as const;

// Catalog page size for the infinite-scroll list. A short final page (< this)
// means there is nothing more to fetch.
const PAGE_SIZE = 60;

interface CatalogImage {
  sha256: string;
  prompt?: string | null;
  negative?: string | null;
  tags?: string[];
  safety?: string | null;
  rating?: number | null;
  favorite?: boolean;
  sourceTool?: string | null;
  params?: Record<string, unknown> | null;
  references?: Array<{ kind: string; name: string; hash?: string | null }>;
  workflow_json?: unknown;
  api_prompt_json?: unknown;
  [key: string]: unknown;
}

interface EditState {
  prompt: string;
  negative: string;
  tags: string;
  safety: string;
  rating: string;
  favorite: boolean;
}

function editFrom(img: CatalogImage): EditState {
  return {
    prompt: img.prompt ?? "",
    negative: img.negative ?? "",
    tags: (img.tags ?? []).join(", "),
    safety: img.safety ?? "",
    rating: img.rating != null ? String(img.rating) : "",
    favorite: Boolean(img.favorite),
  };
}

function Json({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <details className="rounded-lg border border-ui-border/40 bg-ui-bg p-2">
      <summary className="cursor-pointer text-ui-xs font-medium text-ui-ink-title">{label}</summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-ui-2xs text-ui-ink-muted">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export default function DbPage() {
  const [tag, setTag] = useState("");
  const [safety, setSafety] = useState("");
  const [favorite, setFavorite] = useState(false);
  // Separator-insensitive substring match on the on-disk file path. Committed on
  // Enter / Apply (not per keystroke) so a long path doesn't re-query each char.
  const [path, setPath] = useState("");
  const [images, setImages] = useState<CatalogImage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<CatalogImage | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Bulk selection for exclusion (un-index many at once). Separate from
  // `selected` (the single row open in the editor): a checkbox toggles a row into
  // `picked` without opening it.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Page cursor + the scroll container / sentinel for infinite scroll. Filters
  // live in a ref so loadMore() reads the current values without re-creating the
  // callback (which would re-arm the observer on every keystroke).
  const pageRef = useRef(0);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const filtersRef = useRef({ tag, safety, favorite, path });
  useEffect(() => {
    filtersRef.current = { tag, safety, favorite, path };
  });

  const fetchPage = useCallback(async (reset: boolean) => {
    const f = filtersRef.current;
    const offset = reset ? 0 : pageRef.current * PAGE_SIZE;
    const sp = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (f.tag.trim()) sp.set("tag", f.tag.trim());
    if (f.safety) sp.set("safety", f.safety);
    if (f.favorite) sp.set("favorite", "true");
    if (f.path.trim()) sp.set("path", f.path.trim());
    setLoadingMore(true);
    try {
      const j = await fetch(`/api/library/admin/images?${sp.toString()}`).then((r) => r.json());
      const batch: CatalogImage[] = Array.isArray(j.images) ? (j.images as CatalogImage[]) : [];
      setHasMore(batch.length === PAGE_SIZE);
      if (reset) {
        pageRef.current = 1;
        setImages(batch);
      } else {
        pageRef.current += 1;
        setImages((prev) => [...prev, ...batch]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoadingMore(false);
    }
  }, []);

  const load = useCallback(() => fetchPage(true), [fetchPage]);
  const loadMore = useCallback(() => fetchPage(false), [fetchPage]);

  // Re-query from the top whenever a filter changes (mirrors the prior auto-load).
  useEffect(() => {
    fetchPage(true);
  }, [tag, safety, favorite, fetchPage]);

  // Infinite scroll: pull the next page as the sentinel nears the bottom of the
  // scrollable list (root = the list container, not the viewport).
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) loadMore();
      },
      { root: listScrollRef.current, rootMargin: "400px" },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [hasMore, loadingMore, loadMore]);

  const select = (img: CatalogImage) => {
    setSelected(img);
    setEdit(editFrom(img));
    setNotice(null);
    setError(null);
  };

  const save = async () => {
    if (!selected || !edit) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        prompt: edit.prompt,
        negative: edit.negative,
        tags: edit.tags.split(",").map((s) => s.trim()).filter(Boolean),
        safety: edit.safety ? edit.safety : null,
        rating: edit.rating ? Number(edit.rating) : null,
        favorite: edit.favorite,
      };
      const updated = (await fetch(`/api/library/images/${selected.sha256}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => {
        if (!r.ok) throw new Error(`save failed (${r.status})`);
        return r.json();
      })) as CatalogImage;
      setNotice("Saved.");
      setSelected(updated);
      setEdit(editFrom(updated));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const act = async (kind: "reindex" | "relabel") => {
    if (!selected) return;
    setError(null);
    try {
      await fetch(`/api/library/images/${selected.sha256}/${kind}`, { method: "POST" }).then((r) => {
        if (!r.ok) throw new Error(`${kind} failed (${r.status})`);
      });
      setNotice(`${kind === "reindex" ? "Re-index" : "Re-label"} task enqueued.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : `${kind} failed`);
    }
  };

  const deleteEverywhere = async () => {
    if (!selected) return;
    const typed = window.prompt(
      `Type the sha256 to DELETE this image's index (catalog + search + graph; not the file on disk):\n${selected.sha256}`,
    );
    if (typed !== selected.sha256) return;
    setError(null);
    try {
      await fetch(`/api/library/images/${selected.sha256}`, { method: "DELETE" }).then((r) => {
        if (!r.ok) throw new Error(`delete failed (${r.status})`);
      });
      setNotice("Deleted everywhere.");
      setSelected(null);
      setEdit(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  // --- bulk exclusion (un-index many) ------------------------------------
  const togglePick = (sha256: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(sha256)) next.delete(sha256);
      else next.add(sha256);
      return next;
    });

  const pickAllLoaded = () => setPicked(new Set(images.map((i) => i.sha256)));
  const clearPicked = () => {
    setPicked(new Set());
    setConfirmingBulk(false);
  };

  // Un-index every picked image (catalog + search + graph; files stay on disk),
  // fanning the per-image delete out with bounded concurrency. Whatever actually
  // went away is pruned from the list even on a partial failure.
  const excludeSelected = async () => {
    const ids = [...picked];
    if (ids.length === 0) return;
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { deleted, failed } = await deleteImages(ids);
      if (deleted.length > 0) {
        const gone = new Set(deleted);
        setImages((prev) => prev.filter((i) => !gone.has(i.sha256)));
        setPicked((prev) => {
          const next = new Set(prev);
          for (const id of gone) next.delete(id);
          return next;
        });
        if (selected && gone.has(selected.sha256)) {
          setSelected(null);
          setEdit(null);
        }
      }
      if (failed.length > 0) {
        setError(
          `Excluded ${deleted.length}/${ids.length}. ${failed.length} failed: ${failed[0].error}`,
        );
        setConfirmingBulk(false);
      } else {
        setNotice(`Excluded ${deleted.length} image${deleted.length === 1 ? "" : "s"} (un-indexed).`);
        clearPicked();
      }
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-6" data-testid="db-page">
      <header>
        <h1 className="text-ui-2xl font-semibold text-ui-ink-title">Database (power tools)</h1>
        <p className="text-ui-sm text-ui-ink-muted">
          Browse and edit the catalog source of truth. Projections rebuild from here.
        </p>
      </header>

      {error && <p className="text-ui-sm text-rose-500" data-testid="db-error">{error}</p>}
      {notice && <p className="text-ui-sm text-emerald-500" data-testid="db-notice">{notice}</p>}

      {/* Filters */}
      <section className={cls.card} data-testid="db-filters">
        <div className="flex flex-wrap items-end gap-2">
          <input
            className={`${cls.input} max-w-[16rem]`}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="filter by tag"
            data-testid="db-tag"
          />
          <input
            className={`${cls.input} max-w-[18rem]`}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="filter by path (folder/filename fragment)"
            data-testid="db-path"
          />
          <select
            className={`${cls.input} max-w-[10rem]`}
            value={safety}
            onChange={(e) => setSafety(e.target.value)}
            data-testid="db-safety"
          >
            {SAFETY.map((s) => (
              <option key={s} value={s}>
                {s || "any safety"}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-ui-xs text-ui-ink">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
              data-testid="db-favorite"
            />
            favorites only
          </label>
          <button className={cls.btn} onClick={load} data-testid="db-apply">
            Apply
          </button>
        </div>
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* List */}
        <section className={`${cls.card} min-w-0`} data-testid="db-list">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-ui-sm font-semibold text-ui-ink-title">
              Images{" "}
              <span className="text-ui-2xs text-ui-ink-muted">
                ({images.length}
                {hasMore ? "+" : ""})
              </span>
            </h2>
            <button
              className="text-ui-2xs text-ui-ink-muted transition hover:text-accent-cyan"
              onClick={picked.size > 0 ? clearPicked : pickAllLoaded}
              data-testid="db-pick-toggle"
            >
              {picked.size > 0 ? "Clear selection" : "Select all loaded"}
            </button>
          </div>

          {/* Bulk-exclusion bar — un-index every picked image (catalog + search +
              graph). The originals stay on disk. */}
          {picked.size > 0 && (
            <div
              className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-ui-xs"
              data-testid="db-bulk-bar"
            >
              <span className="font-medium text-ui-ink">{picked.size} selected</span>
              <div className="ml-auto flex items-center gap-2">
                {confirmingBulk ? (
                  <>
                    <span className="text-rose-500">Un-index {picked.size}? (files stay on disk)</span>
                    <button
                      className={cls.danger}
                      onClick={excludeSelected}
                      disabled={bulkBusy}
                      data-testid="db-bulk-confirm"
                    >
                      {bulkBusy ? "Excluding…" : "Confirm exclude"}
                    </button>
                    <button className={cls.btn} onClick={() => setConfirmingBulk(false)} disabled={bulkBusy}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className={cls.danger}
                    onClick={() => setConfirmingBulk(true)}
                    data-testid="db-bulk-exclude"
                  >
                    Exclude selected
                  </button>
                )}
              </div>
            </div>
          )}
          <div
            ref={listScrollRef}
            className="flex max-h-[70vh] min-w-0 flex-col gap-1 overflow-y-auto"
          >
            {images.map((img) => (
              <div
                key={img.sha256}
                className={`flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 transition ${
                  selected?.sha256 === img.sha256
                    ? "border-accent-cyan bg-accent-cyan/10"
                    : picked.has(img.sha256)
                      ? "border-rose-500/40 bg-rose-500/5"
                      : "border-ui-border/50 bg-ui-bg hover:bg-ui-bg-soft"
                }`}
                data-testid={`db-row-${img.sha256}`}
              >
                <input
                  type="checkbox"
                  checked={picked.has(img.sha256)}
                  onChange={() => togglePick(img.sha256)}
                  aria-label={`Select ${img.sha256}`}
                  className="ml-1 shrink-0"
                  data-testid={`db-pick-${img.sha256}`}
                />
                <button
                  onClick={() => select(img)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-ui-xs"
                  data-testid={`db-open-${img.sha256}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/library/images/${img.sha256}/thumbnail`}
                    alt=""
                    loading="lazy"
                    className="h-10 w-10 shrink-0 rounded-md border border-ui-border/50 bg-ui-bg-soft object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {img.safety && (
                        <span className="shrink-0 rounded-full bg-ui-bg-soft px-1.5 py-0.5 text-ui-2xs text-ui-ink-muted">
                          {img.safety}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-ui-ink">
                        {img.prompt || img.sha256.slice(0, 16)}
                      </span>
                      {img.favorite && <span className="shrink-0 text-amber-500">★</span>}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-ui-2xs text-ui-ink-muted">
                      {img.sha256}
                    </div>
                  </div>
                </button>
              </div>
            ))}
            {images.length === 0 && !loadingMore && (
              <p className="text-ui-sm text-ui-ink-muted">No images.</p>
            )}
            {/* Infinite-scroll trigger + loading indicator (inside the scroll box). */}
            <div ref={sentinelRef} aria-hidden="true" className="h-px" />
            {loadingMore && (
              <p className="py-2 text-center text-ui-2xs text-ui-ink-muted">Loading…</p>
            )}
          </div>
        </section>

        {/* Detail / editor */}
        <section className={`${cls.card} min-w-0`} data-testid="db-detail">
          {!selected || !edit ? (
            <p className="text-ui-sm text-ui-ink-muted">Select an image to inspect and edit.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/library/images/${selected.sha256}/thumbnail`}
                alt={selected.prompt ?? ""}
                className="max-h-72 w-full rounded-lg border border-ui-border/50 bg-ui-bg-soft object-contain"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-ui-2xs text-ui-ink-muted">{selected.sha256}</span>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <button className={cls.btn} onClick={() => act("reindex")} data-testid="db-reindex">
                    Re-index
                  </button>
                  <button className={cls.btn} onClick={() => act("relabel")} data-testid="db-relabel">
                    Re-label
                  </button>
                  <button className={cls.danger} onClick={deleteEverywhere} data-testid="db-delete">
                    Delete everywhere
                  </button>
                </div>
              </div>

              <label className="text-ui-xs text-ui-ink-muted">
                prompt
                <textarea
                  className={`${cls.input} mt-1 h-20`}
                  value={edit.prompt}
                  onChange={(e) => setEdit({ ...edit, prompt: e.target.value })}
                  data-testid="db-edit-prompt"
                />
              </label>
              <label className="text-ui-xs text-ui-ink-muted">
                negative
                <textarea
                  className={`${cls.input} mt-1 h-16`}
                  value={edit.negative}
                  onChange={(e) => setEdit({ ...edit, negative: e.target.value })}
                />
              </label>
              <label className="text-ui-xs text-ui-ink-muted">
                tags (comma-separated)
                <input
                  className={`${cls.input} mt-1`}
                  value={edit.tags}
                  onChange={(e) => setEdit({ ...edit, tags: e.target.value })}
                  data-testid="db-edit-tags"
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-ui-xs text-ui-ink-muted">
                  safety
                  <select
                    className={`${cls.input} mt-1`}
                    value={edit.safety}
                    onChange={(e) => setEdit({ ...edit, safety: e.target.value })}
                    data-testid="db-edit-safety"
                  >
                    {SAFETY.map((s) => (
                      <option key={s} value={s}>
                        {s || "(unset)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-ui-xs text-ui-ink-muted">
                  rating
                  <input
                    type="number"
                    min={0}
                    max={5}
                    className={`${cls.input} mt-1 w-20`}
                    value={edit.rating}
                    onChange={(e) => setEdit({ ...edit, rating: e.target.value })}
                  />
                </label>
                <label className="mt-4 flex items-center gap-1.5 text-ui-xs text-ui-ink">
                  <input
                    type="checkbox"
                    checked={edit.favorite}
                    onChange={(e) => setEdit({ ...edit, favorite: e.target.checked })}
                  />
                  favorite
                </label>
                <button className={`${cls.btn} mt-4`} onClick={save} disabled={busy} data-testid="db-save">
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>

              {/* Raw JSON inspector */}
              <div className="flex flex-col gap-2">
                <Json label="params" value={selected.params} />
                <Json label="references" value={selected.references} />
                <Json label="workflow_json" value={selected.workflow_json} />
                <Json label="api_prompt_json" value={selected.api_prompt_json} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
