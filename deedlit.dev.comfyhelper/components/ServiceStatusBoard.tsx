"use client";

import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types — mirror the /api/library/health response (see app/api/library/health).
// ---------------------------------------------------------------------------

export type ComponentStatus = "ok" | "degraded" | "down";

interface Dependency {
  name: string;
  ready: boolean;
}

interface ComponentHealth {
  name: string;
  status: ComponentStatus;
  dependencies: Dependency[];
}

interface HealthPayload {
  healthy: boolean;
  status: ComponentStatus;
  gatewayReachable: boolean;
  checkedAt: string;
  components: ComponentHealth[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Presentation helpers.
// ---------------------------------------------------------------------------

/** Friendly one-liner describing what each component is. */
const COMPONENT_BLURB: Record<string, string> = {
  gateway: "BFF — the only API the UI talks to",
  catalog: "Source of truth (Postgres + RustFS)",
  search: "Hybrid vector search (Qdrant)",
  graph: "Relationship graph (Neo4j)",
  ingest: "Ingest & maintenance worker",
  vision: "CLIP + SPLADE embedding service",
  metadata: "PNG metadata extraction",
};

function statusDot(status: ComponentStatus): string {
  switch (status) {
    case "ok":
      return "bg-emerald-500";
    case "degraded":
      return "bg-amber-500";
    case "down":
      return "bg-rose-500";
  }
}

function statusChip(status: ComponentStatus): string {
  switch (status) {
    case "ok":
      return "bg-emerald-500/15 text-emerald-500";
    case "degraded":
      return "bg-amber-500/15 text-amber-500";
    case "down":
      return "bg-rose-500/15 text-rose-500";
  }
}

function statusLabel(status: ComponentStatus): string {
  return status === "ok" ? "online" : status === "degraded" ? "degraded" : "offline";
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

/**
 * System-status board: one card per backend component (gateway, catalog,
 * search, graph, ingest, vision, metadata) with an online/degraded/offline
 * indicator and per-component dependency readiness (Postgres, RustFS, Qdrant,
 * Neo4j, models). Polls /api/library/health every `pollMs`.
 */
export function ServiceStatusBoard({ pollMs = 5000 }: { pollMs?: number }) {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/library/health")
      .then((r) => r.json())
      .then((j: HealthPayload) => setHealth(j))
      .catch(() => setHealth(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  const overall: ComponentStatus = health ? health.status : "down";
  const components = health?.components ?? [];
  const offline = components.filter((c) => c.status !== "ok").length;

  return (
    <section
      className="rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 p-4"
      data-testid="service-status"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-ui-sm font-semibold text-ui-ink-title">System status</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-ui-2xs font-medium ${
              loaded ? statusChip(overall) : "bg-ui-bg text-ui-ink-muted"
            }`}
            data-testid="status-overall"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${loaded ? statusDot(overall) : "bg-ui-ink-muted"}`} />
            {!loaded
              ? "checking…"
              : overall === "ok"
                ? "all systems online"
                : `${offline} component${offline === 1 ? " needs" : "s need"} attention`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-ui-2xs text-ui-ink-muted">
          {health?.checkedAt && <span>updated {relativeTime(health.checkedAt)}</span>}
          <button
            className="rounded-md border border-ui-border/70 px-2 py-1 transition hover:bg-accent-cyan/10"
            onClick={refresh}
            data-testid="status-refresh"
          >
            Refresh
          </button>
        </div>
      </div>

      {health?.warnings?.length ? (
        <p className="mb-3 text-ui-2xs text-rose-500" data-testid="status-warning">
          {health.warnings.join(" · ")}
        </p>
      ) : null}

      {loaded && components.length === 0 ? (
        <p className="text-ui-sm text-ui-ink-muted">No status available.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(loaded ? components : SKELETON).map((c, i) => (
            <div
              key={c.name + i}
              className="flex flex-col gap-2 rounded-lg border border-ui-border/50 bg-ui-bg p-3"
              data-testid={`status-card-${c.name}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-ui-sm font-medium text-ui-ink-title">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(c.status)}`} />
                    {c.name}
                  </p>
                  <p className="mt-0.5 truncate text-ui-2xs text-ui-ink-muted">
                    {COMPONENT_BLURB[c.name] ?? "service"}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-ui-2xs font-medium ${statusChip(c.status)}`}>
                  {statusLabel(c.status)}
                </span>
              </div>

              {c.dependencies.length > 0 && (
                <div className="flex flex-wrap gap-1 border-t border-ui-border/40 pt-2">
                  {c.dependencies.map((d) => (
                    <span
                      key={d.name}
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ui-2xs ${
                        d.ready ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                      }`}
                      title={d.ready ? "ready" : "not ready"}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${d.ready ? "bg-emerald-500" : "bg-rose-500"}`} />
                      {d.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Placeholder cards shown before the first health response lands.
const SKELETON: ComponentHealth[] = [
  "gateway",
  "catalog",
  "search",
  "graph",
  "ingest",
  "vision",
  "metadata",
].map((name) => ({ name, status: "down", dependencies: [] }));
