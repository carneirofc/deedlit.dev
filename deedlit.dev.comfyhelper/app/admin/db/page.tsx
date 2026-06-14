"use client";

import { useCallback, useEffect, useState } from "react";

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
  const [images, setImages] = useState<CatalogImage[]>([]);
  const [selected, setSelected] = useState<CatalogImage | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    const sp = new URLSearchParams({ limit: "100" });
    if (tag.trim()) sp.set("tag", tag.trim());
    if (safety) sp.set("safety", safety);
    if (favorite) sp.set("favorite", "true");
    fetch(`/api/library/admin/images?${sp.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.images)) setImages(j.images as CatalogImage[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [tag, safety, favorite]);

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6" data-testid="db-page">
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

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* List */}
        <section className={cls.card} data-testid="db-list">
          <h2 className="mb-2 text-ui-sm font-semibold text-ui-ink-title">
            Images <span className="text-ui-2xs text-ui-ink-muted">({images.length})</span>
          </h2>
          <div className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto">
            {images.map((img) => (
              <button
                key={img.sha256}
                onClick={() => select(img)}
                className={`rounded-lg border px-3 py-2 text-left text-ui-xs transition ${
                  selected?.sha256 === img.sha256
                    ? "border-accent-cyan bg-accent-cyan/10"
                    : "border-ui-border/50 bg-ui-bg hover:bg-ui-bg-soft"
                }`}
                data-testid={`db-row-${img.sha256}`}
              >
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
              </button>
            ))}
            {images.length === 0 && <p className="text-ui-sm text-ui-ink-muted">No images.</p>}
          </div>
        </section>

        {/* Detail / editor */}
        <section className={cls.card} data-testid="db-detail">
          {!selected || !edit ? (
            <p className="text-ui-sm text-ui-ink-muted">Select an image to inspect and edit.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-ui-2xs text-ui-ink-muted">{selected.sha256}</span>
                <div className="flex shrink-0 gap-1">
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
