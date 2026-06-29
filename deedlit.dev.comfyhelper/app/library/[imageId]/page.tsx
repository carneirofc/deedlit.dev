"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { CopyButton } from "@carneirofc/ui";

import { useActivity } from "@/lib/store/activity";
import { useSettings } from "@/lib/store/settings";

interface Detail {
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

interface CompactResult {
  imageId: string;
  score?: number | null;
  thumbnailUrl: string;
  summary: string;
}

interface GraphData {
  nodes: { id: string; label: string; type: string }[];
  edges: { from: string; to: string; type: string }[];
}

interface RelatedTag {
  name: string;
  coOccurrence: number;
}

interface VectorDebug {
  query: {
    imageId: string;
    vectorFound: boolean;
    stats: {
      dims: number;
      norm: number;
      isZero: boolean;
      nonZero: number;
      min: number;
      max: number;
      sample: number[];
    } | null;
  };
  collection: {
    exists: boolean;
    vectorSize: number | null;
    distance: string | null;
    pointsCount: number | null;
  };
  embedding: {
    provider: string;
    dimensions: number;
    hasExternalImageEmbeddings: boolean;
    clipVisionApiUrl: string | null;
  };
  params: { limit: number; minScore: number; hnswEf: number; exact: boolean };
  hits: Array<{ id: string; score: number; isSelf: boolean; payload: Record<string, unknown> | null }>;
  warnings: string[];
  tookMs: number;
}

const panel = "rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 p-4";
const chip = "rounded-full bg-ui-bg px-2 py-0.5 text-ui-2xs text-ui-ink-muted";

export default function ImageDetailPage() {
  const params = useParams<{ imageId: string }>();
  const imageId = params.imageId;
  const router = useRouter();
  const { settings, setKey, hydrated } = useSettings();
  const { track } = useActivity();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [similar, setSimilar] = useState<CompactResult[]>([]);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [relatedTags, setRelatedTags] = useState<RelatedTag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<VectorDebug | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);

  // Suggestions are fetched once requested — automatically when
  // autoLoadSuggestions is on, otherwise after the user clicks the button.
  const [suggestRequested, setSuggestRequested] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);

  // Inline rating edit state.
  const [ratingBusy, setRatingBusy] = useState(false);

  // Notes state.
  const [notes, setNotes] = useState<{ id: string; title?: string | null; created_at?: string }[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  // Two-step "remove from library" confirmation.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Transient "Copied" state for the source-path copy button.
  const [pathCopied, setPathCopied] = useState(false);

  const rateImage = useCallback(async (rating: number | null) => {
    if (!detail || ratingBusy) return;
    setRatingBusy(true);
    try {
      const res = await fetch(`/api/library/images/${imageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDetail(updated);
      }
    } finally {
      setRatingBusy(false);
    }
  }, [detail, imageId, ratingBusy]);

  // Detail load — independent of settings so the page renders immediately.
  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const res = await fetch(`/api/library/images/${imageId}`, { signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Not found");
      setDetail(json);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [imageId]);

  useEffect(() => {
    // Cancel the detail fetch if the user navigates away before it lands.
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  // Decide whether to auto-fetch suggestions for this image.
  useEffect(() => {
    if (!hydrated) return;
    setSuggestRequested(settings.autoLoadSuggestions);
  }, [imageId, hydrated, settings.autoLoadSuggestions]);

  // Similar images (suggestions).
  useEffect(() => {
    if (!hydrated || !settings.showSimilar || !suggestRequested || settings.similarCount === 0) {
      setSimilar([]);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    setSuggestLoading(true);
    fetch("/api/library/search/similar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageId,
        limit: settings.similarCount,
        minScore: settings.similarMinScore,
      }),
      signal: ac.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setSimilar(j.results ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSuggestLoading(false);
      });
    // Cancel the in-flight request on unmount / dep change (navigation) so a
    // slow similarity query never hangs after the user leaves.
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    hydrated,
    imageId,
    suggestRequested,
    settings.showSimilar,
    settings.similarCount,
    settings.similarMinScore,
  ]);

  // Relationship graph.
  useEffect(() => {
    if (!hydrated || !settings.showRelationshipGraph) {
      setGraph(null);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    fetch(`/api/library/images/${imageId}/graph?depth=${settings.graphDepth}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setGraph(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [hydrated, imageId, settings.showRelationshipGraph, settings.graphDepth]);

  // Related tags — co-occurring tags for this image's most prominent tag.
  useEffect(() => {
    if (
      !hydrated ||
      !settings.showRelatedTags ||
      settings.relatedTagsCount === 0 ||
      !detail ||
      detail.tags.length === 0
    ) {
      setRelatedTags([]);
      return;
    }
    const seed = detail.tags[0].normalizedName || detail.tags[0].name;
    let cancelled = false;
    const ac = new AbortController();
    fetch(`/api/library/tags/${encodeURIComponent(seed)}/related?limit=${settings.relatedTagsCount}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setRelatedTags(Array.isArray(j.related) ? j.related : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [hydrated, detail, settings.showRelatedTags, settings.relatedTagsCount]);

  // Load notes for this image.
  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    setNotesLoading(true);
    fetch(`/api/library/notes/by-image/${encodeURIComponent(imageId)}`, { signal: ac.signal })
      .then((r) => r.ok ? r.json() : [])
      .then((j) => { if (alive) setNotes(Array.isArray(j) ? j : []); })
      .catch(() => {})
      .finally(() => { if (alive) setNotesLoading(false); });
    return () => { alive = false; ac.abort(); };
  }, [imageId]);

  const addNote = useCallback(async () => {
    const text = noteDraft.trim();
    if (!text || noteSaving) return;
    setNoteSaving(true);
    try {
      const res = await fetch("/api/library/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: text, blocks: {}, imageRefs: [imageId] }),
      });
      if (res.ok) {
        setNoteDraft("");
        const r2 = await fetch(`/api/library/notes/by-image/${encodeURIComponent(imageId)}`);
        if (r2.ok) {
          const j = await r2.json();
          setNotes(Array.isArray(j) ? j : []);
        }
      }
    } finally {
      setNoteSaving(false);
    }
  }, [imageId, noteDraft, noteSaving]);

  const toggleFavorite = useCallback(async () => {
    if (!detail) return;
    const next = !detail.favorite;
    try {
      const updated = await track(next ? "Add favorite" : "Remove favorite", async () => {
        const res = await fetch(`/api/library/images/${imageId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ favorite: next }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? "Failed to update favorite");
        }
        return res.json();
      });
      setDetail(updated);
    } catch {
      // Surfaced by the activity dock/toast; nothing else to do here.
    }
  }, [detail, imageId, track]);

  // Remove the image's indexation (catalog record + search vector + graph
  // node) via the gateway. The source file on disk is NOT touched. On success
  // we leave the now-deleted detail page and return to the library.
  const removeFromLibrary = useCallback(async () => {
    setDeleting(true);
    try {
      await track("Remove from library", async () => {
        const res = await fetch(`/api/library/images/${imageId}`, { method: "DELETE" });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? "Failed to remove image");
        }
        return res.json();
      });
      router.push("/library");
      router.refresh();
    } catch {
      // Surfaced by the activity dock/toast; re-enable the controls so the user
      // can retry or cancel.
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }, [imageId, track, router]);

  const loadDebug = useCallback(async () => {
    setDebugOpen((open) => !open);
    if (debug || debugLoading) return; // fetch once
    setDebugLoading(true);
    setDebugError(null);
    try {
      const res = await fetch(`/api/library/images/${imageId}/vector?limit=12`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Debug fetch failed");
      setDebug(json);
    } catch (e) {
      setDebugError(e instanceof Error ? e.message : "Debug fetch failed");
    } finally {
      setDebugLoading(false);
    }
  }, [imageId, debug, debugLoading]);

  const copyPath = () => {
    if (!detail?.filePath) return;
    navigator.clipboard
      ?.writeText(detail.filePath)
      .then(() => {
        setPathCopied(true);
        setTimeout(() => setPathCopied(false), 1500);
      })
      .catch(() => {});
  };

  if (error) return <p className="text-rose-500">{error}</p>;
  if (!detail) return <p className="text-ui-ink-muted">Loading…</p>;

  const viewerSrc = settings.viewerFullResolution
    ? `/api/library/images/${imageId}/file`
    : `/api/library/images/${imageId}/thumbnail`;
  const viewerClass =
    settings.viewerImageFit === "cover"
      ? "h-[80vh] w-full bg-ui-bg object-cover"
      : "max-h-[80vh] w-full bg-ui-bg object-contain";

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <Link href="/library" prefetch={false} className="text-ui-sm text-accent-cyan">
        ← Back to library
      </Link>

      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <div className="relative w-full overflow-hidden rounded-xl border border-ui-border/60 xl:w-[55%] xl:max-w-[1400px]">
          {/* Quality indicator + quick toggle: HD original vs cached thumbnail. */}
          <button
            type="button"
            onClick={() => setKey("viewerFullResolution", !settings.viewerFullResolution)}
            aria-pressed={settings.viewerFullResolution}
            title="Toggle full-resolution original"
            className={`absolute left-2 top-2 z-10 rounded-md border px-2 py-1 text-ui-2xs font-semibold backdrop-blur transition ${
              settings.viewerFullResolution
                ? "border-accent-cyan bg-ui-bg/80 text-accent-cyan"
                : "border-ui-border/60 bg-ui-bg/80 text-ui-ink-muted hover:text-ui-ink"
            }`}
          >
            {settings.viewerFullResolution ? "HD · original" : "Thumbnail"}
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewerSrc} alt={detail.filename} className={viewerClass} />
        </div>

        {/* Panels: column-width (not fixed count) — browser fits as many
            ≥24rem columns as the available space allows, so text never cramps
            and extra desktop width just adds columns. */}
        <div className="min-w-0 flex-1 columns-[24rem] gap-4 [&>div]:mb-4 [&>div]:break-inside-avoid">
          <div className={panel}>
            <div className="flex items-center justify-between">
              <h1 className="truncate text-ui-lg font-semibold text-ui-ink-title">{detail.filename}</h1>
              <button onClick={toggleFavorite} className="text-ui-xl" aria-label="favorite">
                {detail.favorite ? "★" : "☆"}
              </button>
            </div>

            {/* Star rating */}
            <div className="mt-2 flex items-center gap-0.5" role="group" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => rateImage(detail.rating === n ? null : n)}
                  disabled={ratingBusy}
                  className={`text-xl leading-none transition disabled:opacity-50 ${
                    n <= (detail.rating ?? 0)
                      ? "text-amber-400 hover:text-amber-300"
                      : "text-ui-ink-muted/30 hover:text-amber-400/70"
                  }`}
                  title={`${n}★${detail.rating === n ? " — click to clear" : ""}`}
                  aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
                >
                  ★
                </button>
              ))}
              {detail.rating != null && (
                <button
                  type="button"
                  onClick={() => rateImage(null)}
                  disabled={ratingBusy}
                  className="ml-1 text-ui-2xs text-ui-ink-muted/60 transition hover:text-rose-400 disabled:opacity-50"
                  title="Clear rating"
                >
                  ✕
                </button>
              )}
            </div>

            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui-xs text-ui-ink-muted">
              <dt>Model</dt><dd className="break-words text-ui-ink">{detail.model ?? "—"}</dd>
              <dt>Family</dt><dd className="break-words text-ui-ink">{detail.modelFamily ?? "—"}</dd>
              <dt>Source</dt><dd className="break-words text-ui-ink">{detail.sourceTool ?? "—"}</dd>
              <dt>Size</dt><dd className="break-words text-ui-ink">{detail.width}×{detail.height}</dd>
            </dl>

            {/* Originating filesystem path, captured at ingest. The image's id is
                the opaque sha256, so this is the only way back to the source file
                on disk — surface it in full (and copyable), never truncated away. */}
            {detail.filePath && (
              <div className="mt-3 border-t border-ui-border/40 pt-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-ui-2xs font-medium uppercase tracking-wide text-ui-ink-muted">
                    Source file
                  </p>
                  <CopyButton
                    copied={pathCopied}
                    onClick={copyPath}
                    aria-label="Copy source file path"
                  />
                </div>
                <p className="break-all font-mono text-ui-2xs text-ui-ink" title={detail.filePath}>
                  {detail.filePath}
                </p>
              </div>
            )}

            <div className="mt-3 border-t border-ui-border/40 pt-3">
              {!confirmingDelete ? (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="text-ui-xs text-rose-400 transition hover:text-rose-300"
                >
                  Remove from library
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-ui-2xs text-ui-ink-muted">
                    Remove this image&rsquo;s catalog record, search vector and graph
                    links? The original file on disk is not deleted.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={removeFromLibrary}
                      disabled={deleting}
                      className="rounded-lg bg-rose-500/90 px-2.5 py-1 text-ui-xs font-medium text-white transition hover:bg-rose-500 disabled:opacity-60"
                    >
                      {deleting ? "Removing…" : "Remove"}
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(false)}
                      disabled={deleting}
                      className="rounded-lg border border-ui-border/70 px-2.5 py-1 text-ui-xs transition hover:bg-ui-bg-soft disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {settings.showDescription && detail.descriptions.length > 0 && (
            <div className={panel}>
              <h2 className="mb-1 text-ui-sm font-semibold text-ui-ink-title">AI description</h2>
              <div className="flex flex-col gap-2">
                {detail.descriptions.map((d) => (
                  <div key={d.id}>
                    <p className="whitespace-pre-wrap text-ui-xs text-ui-ink">{d.description}</p>
                    {d.provider && (
                      <p className="mt-1 text-ui-2xs text-ui-ink-muted">via {d.provider}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {settings.showPrompt && (detail.prompt || detail.negativePrompt) && (
            <div className={panel}>
              {detail.prompt && (
                <>
                  <h2 className="mb-1 text-ui-sm font-semibold text-ui-ink-title">Prompt</h2>
                  <p className="whitespace-pre-wrap text-ui-xs text-ui-ink">{detail.prompt}</p>
                </>
              )}
              {detail.negativePrompt && (
                <>
                  <h2 className={`mb-1 text-ui-sm font-semibold text-ui-ink-title ${detail.prompt ? "mt-3" : ""}`}>
                    Negative prompt
                  </h2>
                  <p className="whitespace-pre-wrap text-ui-xs text-ui-ink-muted">{detail.negativePrompt}</p>
                </>
              )}
            </div>
          )}

          {detail.tags.length > 0 && (
            <div className={panel}>
              <h2 className="mb-2 text-ui-sm font-semibold text-ui-ink-title">Tags</h2>
              <div className="flex flex-wrap gap-1">
                {detail.tags.map((t) => (
                  <Link
                    key={`${t.normalizedName}-${t.source}`}
                    href={`/library?tags=${encodeURIComponent(t.normalizedName || t.name)}`}
                    prefetch={false}
                    className={`${chip} transition hover:text-accent-cyan`}
                  >
                    {t.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {settings.showRelatedTags && relatedTags.length > 0 && (
            <div className={panel}>
              <h2 className="mb-2 text-ui-sm font-semibold text-ui-ink-title">Related tags</h2>
              <div className="flex flex-wrap gap-1">
                {relatedTags.map((t) => (
                  <Link
                    key={t.name}
                    href={`/library?tags=${encodeURIComponent(t.name)}`}
                    prefetch={false}
                    className="flex items-center gap-1 rounded-full bg-ui-bg px-2 py-0.5 text-ui-2xs text-ui-ink-muted transition hover:text-accent-cyan"
                    title={`${t.coOccurrence} images also tagged ${t.name}`}
                  >
                    {t.name}
                    <span className="text-ui-ink-muted/60">{t.coOccurrence}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {detail.loras.length > 0 && (
            <div className={panel}>
              <h2 className="mb-2 text-ui-sm font-semibold text-ui-ink-title">LoRAs</h2>
              <ul className="text-ui-xs text-ui-ink">
                {detail.loras.map((l) => (
                  <li key={l.name}>{l.name} {l.weight != null ? `(${l.weight})` : ""}</li>
                ))}
              </ul>
            </div>
          )}

          {settings.showGenerationParams && detail.generationParams && (
            <div className={panel}>
              <h2 className="mb-2 text-ui-sm font-semibold text-ui-ink-title">Generation</h2>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui-xs text-ui-ink-muted">
                {Object.entries(detail.generationParams)
                  .filter(([, v]) => v != null)
                  .map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="break-words">{k}</dt>
                      <dd className="break-words text-ui-ink">{String(v)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
        </div>
      </div>

      {settings.showSimilar && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-ui-lg font-semibold text-ui-ink-title">Similar images</h2>
            <div className="flex items-center gap-3">
              {suggestLoading && <span className="text-ui-xs text-ui-ink-muted">Loading…</span>}
              <button
                onClick={loadDebug}
                className="rounded-lg border border-ui-border/60 px-2 py-1 text-ui-xs text-ui-ink-muted hover:border-accent-cyan hover:text-accent-cyan"
              >
                {debugOpen ? "Hide" : "Show"} vector debug
              </button>
            </div>
          </div>
          {!suggestRequested ? (
            <button
              onClick={() => setSuggestRequested(true)}
              className="rounded-lg border border-ui-border/70 bg-ui-bg-soft px-3 py-2 text-ui-sm font-medium transition hover:bg-accent-cyan/10"
            >
              Load similar images
            </button>
          ) : similar.length > 0 ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12 5xl:grid-cols-14">
              {similar.map((s) => (
                <Link
                  key={s.imageId}
                  href={`/library/${s.imageId}`}
                  prefetch={false}
                  className="group relative overflow-hidden rounded-lg border border-ui-border/60 hover:border-accent-cyan"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.thumbnailUrl} alt={s.summary} loading="lazy" className="aspect-square w-full object-cover" />
                  {s.score != null && (
                    <span className="absolute bottom-1 right-1 rounded bg-ui-bg/85 px-1.5 py-0.5 text-ui-2xs font-mono text-accent-cyan">
                      {s.score.toFixed(3)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            !suggestLoading && (
              <p className="text-ui-sm text-ui-ink-muted">No similar images found.</p>
            )
          )}
        </section>
      )}

      {/* Notes / comments section */}
      <section className={panel}>
        <h2 className="mb-3 text-ui-lg font-semibold text-ui-ink-title">Notes</h2>
        {notesLoading ? (
          <p className="text-ui-xs text-ui-ink-muted">Loading notes…</p>
        ) : notes.length === 0 ? (
          <p className="mb-3 text-ui-xs text-ui-ink-muted">No notes yet.</p>
        ) : (
          <ul className="mb-3 flex flex-col gap-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-ui-border/40 bg-ui-bg/60 px-3 py-2">
                <p className="text-ui-xs text-ui-ink">{n.title ?? "(empty)"}</p>
                {n.created_at && (
                  <p className="mt-0.5 text-ui-2xs text-ui-ink-muted/60">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-ui-border/70 bg-ui-bg px-3 py-2 text-ui-xs outline-none focus:border-accent-cyan"
            placeholder="Add a note…"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
            disabled={noteSaving}
          />
          <button
            className="rounded-lg border border-ui-border/70 bg-ui-bg-soft px-3 py-2 text-ui-xs font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50"
            onClick={addNote}
            disabled={!noteDraft.trim() || noteSaving}
          >
            {noteSaving ? "…" : "Add"}
          </button>
        </div>
      </section>

      {debugOpen && (
        <section className={panel}>
          <h2 className="mb-2 text-ui-lg font-semibold text-ui-ink-title">Vector debug</h2>
          {debugLoading && <p className="text-ui-xs text-ui-ink-muted">Loading…</p>}
          {debugError && <p className="text-ui-xs text-rose-500">{debugError}</p>}
          {debug && (
            <div className="flex flex-col gap-3 text-ui-xs">
              {debug.warnings.length > 0 && (
                <ul className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-300">
                  {debug.warnings.map((w, i) => (
                    <li key={i}>⚠ {w}</li>
                  ))}
                </ul>
              )}
              <dl className="grid grid-cols-2 gap-1 text-ui-ink-muted sm:grid-cols-4">
                <dt>Embedder</dt>
                <dd className="text-ui-ink">{debug.embedding.provider}</dd>
                <dt>Semantic (CLIP)</dt>
                <dd className={debug.embedding.hasExternalImageEmbeddings ? "text-emerald-400" : "text-amber-400"}>
                  {debug.embedding.hasExternalImageEmbeddings ? "yes" : "no — vision not configured"}
                </dd>
                <dt>Embedder dims</dt>
                <dd className="text-ui-ink">{debug.embedding.dimensions}</dd>
                <dt>Collection dims</dt>
                <dd className={
                  debug.collection.vectorSize === debug.embedding.dimensions ? "text-ui-ink" : "text-rose-400"
                }>
                  {debug.collection.vectorSize ?? "—"} {debug.collection.distance ? `(${debug.collection.distance})` : ""}
                </dd>
                <dt>Points</dt>
                <dd className="text-ui-ink">{debug.collection.pointsCount ?? "—"}</dd>
                <dt>hnsw_ef / exact</dt>
                <dd className="text-ui-ink">{debug.params.hnswEf} / {String(debug.params.exact)}</dd>
                <dt>minScore</dt>
                <dd className="text-ui-ink">{debug.params.minScore}</dd>
                <dt>Took</dt>
                <dd className="text-ui-ink">{debug.tookMs} ms</dd>
              </dl>
              {debug.query.stats && (
                <dl className="grid grid-cols-2 gap-1 text-ui-ink-muted sm:grid-cols-4">
                  <dt>Vector norm</dt>
                  <dd className={debug.query.stats.isZero ? "text-rose-400" : "text-ui-ink"}>
                    {debug.query.stats.norm.toFixed(4)} {debug.query.stats.isZero ? "(ZERO — reindex!)" : ""}
                  </dd>
                  <dt>Non-zero</dt>
                  <dd className="text-ui-ink">{debug.query.stats.nonZero}/{debug.query.stats.dims}</dd>
                  <dt>min / max</dt>
                  <dd className="text-ui-ink">{debug.query.stats.min.toFixed(3)} / {debug.query.stats.max.toFixed(3)}</dd>
                  <dt>sample</dt>
                  <dd className="truncate font-mono text-ui-ink" title={debug.query.stats.sample.join(", ")}>
                    [{debug.query.stats.sample.map((n) => n.toFixed(2)).join(", ")}]
                  </dd>
                </dl>
              )}
              {!debug.query.vectorFound && (
                <p className="text-rose-400">No stored vector — image not indexed in Qdrant.</p>
              )}
              {debug.hits.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-ui-2xs">
                    <thead className="text-ui-ink-muted">
                      <tr>
                        <th className="py-1 pr-3">#</th>
                        <th className="py-1 pr-3">score</th>
                        <th className="py-1 pr-3">checkpoint</th>
                        <th className="py-1 pr-3">model_family</th>
                        <th className="py-1">tags</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-ui-ink">
                      {debug.hits.map((h, i) => (
                        <tr key={h.id} className="border-t border-ui-border/40">
                          <td className="py-1 pr-3">{i + 1}</td>
                          <td className="py-1 pr-3 text-accent-cyan">{h.score.toFixed(4)}</td>
                          <td className="py-1 pr-3">{String(h.payload?.checkpoint ?? "—")}</td>
                          <td className="py-1 pr-3">{String(h.payload?.model_family ?? "—")}</td>
                          <td className="max-w-[20rem] truncate py-1" title={Array.isArray(h.payload?.tags) ? (h.payload?.tags as string[]).join(", ") : ""}>
                            {Array.isArray(h.payload?.tags) ? (h.payload?.tags as string[]).slice(0, 6).join(", ") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {settings.showRelationshipGraph && graph && graph.nodes.length > 0 && (
        <section className={panel}>
          <h2 className="mb-2 text-ui-lg font-semibold text-ui-ink-title">Relationship graph</h2>
          <div className="flex flex-wrap gap-2">
            {graph.nodes.map((n) => (
              <span
                key={n.id}
                className={`rounded-lg border border-ui-border/60 px-2 py-1 text-ui-xs ${n.type === "Image" ? "bg-accent-cyan/10 text-accent-cyan" : "text-ui-ink-muted"}`}
              >
                {n.type}: {n.label}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
