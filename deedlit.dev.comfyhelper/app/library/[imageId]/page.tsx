"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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
  const { settings, hydrated } = useSettings();

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

  // Detail load — independent of settings so the page renders immediately.
  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/library/images/${imageId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Not found");
      setDetail(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [imageId]);

  useEffect(() => {
    load();
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
    setSuggestLoading(true);
    fetch("/api/library/search/similar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageId,
        limit: settings.similarCount,
        minScore: settings.similarMinScore,
      }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setSimilar(j.results ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSuggestLoading(false);
      });
    return () => {
      cancelled = true;
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
    fetch(`/api/library/images/${imageId}/graph?depth=${settings.graphDepth}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setGraph(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
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
    fetch(`/api/library/tags/${encodeURIComponent(seed)}/related?limit=${settings.relatedTagsCount}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setRelatedTags(Array.isArray(j.related) ? j.related : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hydrated, detail, settings.showRelatedTags, settings.relatedTagsCount]);

  const toggleFavorite = useCallback(async () => {
    if (!detail) return;
    const res = await fetch(`/api/library/images/${imageId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorite: !detail.favorite }),
    });
    if (res.ok) setDetail(await res.json());
  }, [detail, imageId]);

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
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <Link href="/library" prefetch={false} className="text-ui-sm text-accent-cyan">
        ← Back to library
      </Link>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-xl border border-ui-border/60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewerSrc} alt={detail.filename} className={viewerClass} />
        </div>

        <div className="flex flex-col gap-4">
          <div className={panel}>
            <div className="flex items-center justify-between">
              <h1 className="truncate text-ui-lg font-semibold text-ui-ink-title">{detail.filename}</h1>
              <button onClick={toggleFavorite} className="text-ui-xl" aria-label="favorite">
                {detail.favorite ? "★" : "☆"}
              </button>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-1 text-ui-xs text-ui-ink-muted">
              <dt>Model</dt><dd className="text-ui-ink">{detail.model ?? "—"}</dd>
              <dt>Family</dt><dd className="text-ui-ink">{detail.modelFamily ?? "—"}</dd>
              <dt>Source</dt><dd className="text-ui-ink">{detail.sourceTool ?? "—"}</dd>
              <dt>Size</dt><dd className="text-ui-ink">{detail.width}×{detail.height}</dd>
            </dl>
          </div>

          {settings.showPrompt && detail.prompt && (
            <div className={panel}>
              <h2 className="mb-1 text-ui-sm font-semibold text-ui-ink-title">Prompt</h2>
              <p className="whitespace-pre-wrap text-ui-xs text-ui-ink">{detail.prompt}</p>
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
              <dl className="grid grid-cols-2 gap-1 text-ui-xs text-ui-ink-muted">
                {Object.entries(detail.generationParams)
                  .filter(([, v]) => v != null)
                  .map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt>{k}</dt>
                      <dd className="text-ui-ink">{String(v)}</dd>
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
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
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
                  {debug.embedding.hasExternalImageEmbeddings ? "yes" : "no — color/layout fallback"}
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
