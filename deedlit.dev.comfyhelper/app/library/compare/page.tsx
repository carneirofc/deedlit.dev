"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { LibraryGraph } from "@/app/library/components/LibraryGraph";
import { useCompareTray } from "@/lib/store/compare-tray";
import type { CompareResult } from "@/lib/library/schemas";

const panel = "rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 p-4";

function gridCols(n: number): React.CSSProperties {
  return { gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))` };
}

function ComparePageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const tray = useCompareTray();
  const idsParam = params.get("ids") ?? "";
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);

  const [data, setData] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (imageIds: string[]) => {
    if (imageIds.length < 2) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/library/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageIds }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Compare failed");
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compare failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsParam]);

  const score = (a: string, b: string): number | null => {
    const hit = data?.pairwiseSimilarity.find(
      (p) => (p.a === a && p.b === b) || (p.a === b && p.b === a),
    );
    return hit ? hit.score : null;
  };

  const n = data?.images.length ?? ids.length;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-ui-2xl font-semibold text-ui-ink-title">Compare images</h1>
          <p className="text-ui-sm text-ui-ink-muted">
            Side-by-side metadata diff, shared tags, and embedding similarity.
          </p>
        </div>
        <Link href="/library" prefetch={false} className="text-ui-sm text-accent-cyan">
          ← Back to library
        </Link>
      </header>

      {ids.length < 2 && (
        <p className="text-ui-sm text-ui-ink-muted">
          Pick at least two images (use the “Compare” button on cards) to compare them.
        </p>
      )}
      {error && <p className="text-ui-sm text-rose-500">{error}</p>}
      {loading && !data && <p className="text-ui-sm text-ui-ink-muted">Loading…</p>}

      {data && data.images.length >= 2 && (
        <>
          {/* Image columns */}
          <div className="grid gap-3" style={gridCols(n)}>
            {data.images.map((img) => (
              <div key={img.id} className="flex flex-col gap-2">
                <Link
                  href={`/library/${img.id}`}
                  prefetch={false}
                  className="overflow-hidden rounded-xl border border-ui-border/60 hover:border-accent-cyan"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.imageUrl}
                    alt={img.filename}
                    className="aspect-square w-full bg-ui-bg object-contain"
                  />
                </Link>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-ui-xs text-ui-ink" title={img.filename}>
                    {img.filename}
                  </span>
                  <button
                    onClick={() => {
                      tray.remove(img.id);
                      const next = ids.filter((x) => x !== img.id);
                      router.replace(`/library/compare?ids=${next.join(",")}`);
                    }}
                    className="shrink-0 text-ui-2xs text-ui-ink-muted hover:text-rose-500"
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pairwise similarity */}
          <section className={panel}>
            <h2 className="mb-2 text-ui-sm font-semibold text-ui-ink-title">Embedding similarity</h2>
            {data.similarityAvailable ? (
              <div className="flex flex-wrap gap-2">
                {data.images.flatMap((a, i) =>
                  data.images.slice(i + 1).map((b) => {
                    const s = score(a.id, b.id);
                    return (
                      <span
                        key={`${a.id}-${b.id}`}
                        className="flex items-center gap-1.5 rounded-lg border border-ui-border/60 px-2 py-1 text-ui-xs"
                      >
                        <span className="text-ui-ink-muted">{a.filename.slice(0, 10)}…</span>
                        <span className="text-ui-ink-muted">↔</span>
                        <span className="text-ui-ink-muted">{b.filename.slice(0, 10)}…</span>
                        <span className="rounded bg-accent-cyan/15 px-1.5 py-0.5 text-accent-cyan">
                          {s != null ? s.toFixed(3) : "—"}
                        </span>
                      </span>
                    );
                  }),
                )}
              </div>
            ) : (
              <p className="text-ui-xs text-ui-ink-muted">
                No embeddings indexed for these images (rebuild Qdrant to enable similarity).
              </p>
            )}
          </section>

          {/* Diff table */}
          <section className={panel}>
            <h2 className="mb-2 text-ui-sm font-semibold text-ui-ink-title">Metadata</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-ui-xs">
                <tbody>
                  {data.fields.map((f) => (
                    <tr
                      key={f.key}
                      className={`border-b border-ui-border/40 ${f.allEqual ? "" : "bg-amber-500/5"}`}
                    >
                      <th className="py-1.5 pr-3 text-left align-top font-medium text-ui-ink-muted">
                        {f.label}
                      </th>
                      {f.values.map((v, i) => (
                        <td
                          key={i}
                          className={`py-1.5 pr-3 align-top ${f.allEqual ? "text-ui-ink-muted" : "text-ui-ink"}`}
                        >
                          {v ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Tags */}
          <section className={panel}>
            <h2 className="mb-2 text-ui-sm font-semibold text-ui-ink-title">Tags</h2>
            {data.sharedTags.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-ui-2xs uppercase tracking-wide text-ui-ink-muted">Shared</p>
                <div className="flex flex-wrap gap-1">
                  {data.sharedTags.map((t) => (
                    <span key={t} className="rounded-full bg-accent-cyan/15 px-2 py-0.5 text-ui-2xs text-accent-cyan">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-3" style={gridCols(n)}>
              {data.images.map((img, i) => (
                <div key={img.id}>
                  <p className="mb-1 text-ui-2xs uppercase tracking-wide text-ui-ink-muted">
                    Only in {img.filename.slice(0, 14)}…
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(data.uniqueTags[i] ?? []).length === 0 ? (
                      <span className="text-ui-2xs text-ui-ink-muted">—</span>
                    ) : (
                      data.uniqueTags[i].map((t) => (
                        <span key={t} className="rounded-full bg-ui-bg px-2 py-0.5 text-ui-2xs text-ui-ink-muted">
                          {t}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Prompts */}
          {data.images.some((i) => i.prompt) && (
            <section className={panel}>
              <h2 className="mb-2 text-ui-sm font-semibold text-ui-ink-title">Prompts</h2>
              <div className="grid gap-3" style={gridCols(n)}>
                {data.images.map((img) => (
                  <p key={img.id} className="whitespace-pre-wrap text-ui-2xs text-ui-ink">
                    {img.prompt ?? "—"}
                  </p>
                ))}
              </div>
            </section>
          )}

          {/* Relationship graph */}
          <section className={panel}>
            <h2 className="mb-2 text-ui-sm font-semibold text-ui-ink-title">
              Relationship graph
              <span className="ml-2 text-ui-2xs font-normal text-ui-ink-muted">
                (shared tags / models highlighted)
              </span>
            </h2>
            <LibraryGraph
              graph={data.graph}
              height="460px"
              onNodeClick={(id, type) => {
                if (type === "Image") router.push(`/library/${id}`);
              }}
            />
          </section>
        </>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<p className="text-ui-sm text-ui-ink-muted">Loading…</p>}>
      <ComparePageInner />
    </Suspense>
  );
}
