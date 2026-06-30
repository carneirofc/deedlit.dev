"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";

import { PathInput } from "@/components/PathInput";
import { SourceFoldersPanel } from "@/components/SourceFoldersPanel";
import { normalizePath, splitPaths } from "@/lib/library/paths";
import { useActivity } from "@/lib/store/activity";

// ---------------------------------------------------------------------------
// Types mirroring the library API responses.
// ---------------------------------------------------------------------------

interface JobSummary {
  id: string;
  folderPath: string | null;
  status: string;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  /** Current pipeline stage — which microservice is active right now. */
  stage: string | null;
  /** Per-stage reached-count for the expandable staircase. */
  stageCounts: Record<string, number>;
}

// Pipeline stages in execution order — drives the expanded per-job staircase so
// rows render in a stable, meaningful sequence (mirrors deedlit.ingest).
const PIPELINE_STAGES = [
  "hash",
  "metadata",
  "label",
  "vision:dense",
  "vision:sparse",
  "catalog",
  "search",
  "graph",
] as const;

// Grafana base URL for the trace deep-link (compose maps it to :3002).
const GRAFANA_URL = process.env.NEXT_PUBLIC_GRAFANA_URL ?? "http://localhost:3002";

interface JobDetail {
  job: JobSummary;
  failedFiles: Array<{ filePath: string; error: string | null }>;
}

interface IngestOptions {
  recursive: boolean;
  generateThumbnails: boolean;
  extractMetadata: boolean;
  runExternalEnrichment: boolean;
  indexQdrant: boolean;
  syncNeo4j: boolean;
}

const DEFAULT_INGEST_OPTIONS: IngestOptions = {
  recursive: true,
  generateThumbnails: true,
  extractMetadata: true,
  runExternalEnrichment: false,
  indexQdrant: true,
  syncNeo4j: true,
};

// ---------------------------------------------------------------------------
// Shared style tokens (matches app/library/page.tsx conventions).
// ---------------------------------------------------------------------------

const cls = {
  card: "rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 p-4",
  input:
    "w-full rounded-lg border border-ui-border/70 bg-ui-bg px-3 py-2 text-ui-sm outline-none focus:border-accent-cyan",
  btn: "rounded-lg border border-ui-border/70 bg-ui-bg-soft px-3 py-2 text-ui-sm font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50",
  btnActive: "border-accent-cyan text-accent-cyan",
};

const ACTIVE_JOB_STATUSES = new Set(["pending", "running"]);

// ---------------------------------------------------------------------------
// Maintenance action descriptors.
// ---------------------------------------------------------------------------

type ActionStatus = "idle" | "running" | "done" | "error";

interface MaintenanceAction {
  key: string;
  label: string;
  description: string;
  endpoint: string;
}

const MAINTENANCE_ACTIONS: MaintenanceAction[] = [
  {
    key: "rebuild-qdrant",
    label: "Rebuild Qdrant",
    description: "Recompute & re-index every image vector.",
    endpoint: "/api/library/maintenance/rebuild-qdrant",
  },
  {
    key: "rebuild-neo4j",
    label: "Rebuild Neo4j",
    description: "Resync the graph projection from Postgres.",
    endpoint: "/api/library/maintenance/rebuild-neo4j",
  },
  {
    key: "prune-graph-orphans",
    label: "Prune graph orphans",
    description: "Remove orphaned tag/model nodes left behind by deleted images.",
    endpoint: "/api/library/maintenance/prune-graph-orphans",
  },
  {
    key: "regenerate-thumbnails",
    label: "Regenerate thumbnails",
    description: "Generate thumbnails for images missing one.",
    endpoint: "/api/library/maintenance/regenerate-thumbnails",
  },
  {
    key: "rescan-files",
    label: "Rescan files",
    description: "Mark images whose source file vanished as missing.",
    endpoint: "/api/library/maintenance/rescan-files",
  },
  {
    key: "backfill-labels",
    label: "Backfill labels",
    description: "Run the labelagent on every image missing an AI description.",
    endpoint: "/api/library/maintenance/backfill-labels",
  },
];

interface ActionRun {
  status: ActionStatus;
  result: string | null;
}

// ---------------------------------------------------------------------------
// Missing-files cleanup (#) — find catalog entries whose source file vanished
// from disk, then un-index the selected stale records via batch-delete.
// ---------------------------------------------------------------------------

interface MissingFile {
  sha256: string;
  filepath: string;
  filename?: string | null;
  directory?: string | null;
}

interface MissingFilesResult {
  checked: number;
  missing: MissingFile[];
  missingCount: number;
  truncated: boolean;
}

// Scan deep enough to surface a meaningful batch in one pass; the API caps it.
const MISSING_SCAN_LIMIT = 2000;

function jobStatusColor(status: string): string {
  switch (status) {
    case "running":
      return "bg-sky-500/15 text-sky-500";
    case "completed":
      return "bg-emerald-500/15 text-emerald-500";
    case "failed":
      return "bg-rose-500/15 text-rose-500";
    case "cancelled":
      return "bg-amber-500/15 text-amber-500";
    // Left in-flight by an ingest restart (its in-memory worker is gone). A
    // terminal state — re-trigger the job manually to re-run it.
    case "interrupted":
      return "bg-orange-500/15 text-orange-500";
    default:
      return "bg-ui-bg text-ui-ink-muted";
  }
}

export default function AdminPage() {
  const { fetchJson, trackJob } = useActivity();

  // Ingest
  const [folderPath, setFolderPath] = useState("");
  const [options, setOptions] = useState<IngestOptions>(DEFAULT_INGEST_OPTIONS);
  const [ingestBusy, setIngestBusy] = useState(false);
  // Bulk one-shot ingest: one path per line, one job dispatched per path.
  const [multiMode, setMultiMode] = useState(false);
  const [multiText, setMultiText] = useState("");

  // Maintenance
  const [runs, setRuns] = useState<Record<string, ActionRun>>({});

  // Missing-files cleanup
  const [missingState, setMissingState] = useState<
    "idle" | "scanning" | "done" | "error"
  >("idle");
  const [missing, setMissing] = useState<MissingFilesResult | null>(null);
  const [missingError, setMissingError] = useState<string | null>(null);
  const [selectedMissing, setSelectedMissing] = useState<Set<string>>(new Set());
  const [deletingMissing, setDeletingMissing] = useState(false);
  const [missingNotice, setMissingNotice] = useState<string | null>(null);

  // Jobs
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);

  // Global feedback
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshJobs = useCallback(() => {
    fetch("/api/library/jobs")
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.jobs)) setJobs(j.jobs as JobSummary[]);
      })
      .catch(() => {});
  }, []);

  // Initial load + polling. (The status board self-polls its own health.)
  useEffect(() => {
    refreshJobs();
    const jobsId = setInterval(refreshJobs, 3000);
    return () => clearInterval(jobsId);
  }, [refreshJobs]);

  // Load detail for the expanded job (and keep it fresh while jobs poll).
  useEffect(() => {
    if (!expanded) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/library/jobs/${expanded}`)
      .then((r) => r.json())
      .then((j: JobDetail) => {
        if (!cancelled && j.job) setDetail(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [expanded, jobs]);

  // Dispatch one folder ingest and hand the job to the global activity poller so
  // its progress shows in the dock from any page. Returns the dispatched job id.
  const dispatchIngest = async (path: string): Promise<string | null | undefined> => {
    const name = path.split(/[\\/]/).pop() || path;
    const j = await fetchJson<{ job_id?: string | null }>(
      `Ingest ${name}`,
      "/api/library/ingest/folder",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath: path, ...options }),
      },
    );
    trackJob(`Ingest ${name}`, j.job_id);
    return j.job_id;
  };

  const startIngestMultiple = async () => {
    const paths = splitPaths(multiText);
    if (paths.length === 0) {
      setError("Enter one folder path per line.");
      return;
    }
    setIngestBusy(true);
    setError(null);
    setNotice(null);
    let started = 0;
    const errors: string[] = [];
    for (const path of paths) {
      try {
        await dispatchIngest(path);
        started++;
      } catch (e) {
        errors.push(`${path}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setIngestBusy(false);
    if (started > 0) setNotice(`Started ${started} ingestion job${started === 1 ? "" : "s"}.`);
    if (errors.length) setError(errors.join(" · "));
    refreshJobs();
  };

  const startIngest = async () => {
    if (multiMode) return startIngestMultiple();
    const path = normalizePath(folderPath);
    if (!path) {
      setError("Folder path is required.");
      return;
    }
    setIngestBusy(true);
    setError(null);
    setNotice(null);
    try {
      const jobId = await dispatchIngest(path);
      setNotice(`Ingestion started — job ${jobId}`);
      refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setIngestBusy(false);
    }
  };

  const runMaintenance = async (action: MaintenanceAction) => {
    setRuns((prev) => ({ ...prev, [action.key]: { status: "running", result: null } }));
    setError(null);
    try {
      const j = await fetchJson<{ id?: string | null; job_id?: string | null }>(
        action.label,
        action.endpoint,
        { method: "POST" },
      );
      // Maintenance actions dispatch a job too — surface its live progress in the dock.
      trackJob(action.label, j.id ?? j.job_id);
      refreshJobs();
      setRuns((prev) => ({
        ...prev,
        [action.key]: { status: "done", result: JSON.stringify(j) },
      }));
    } catch (e) {
      setRuns((prev) => ({
        ...prev,
        [action.key]: {
          status: "error",
          result: e instanceof Error ? e.message : "failed",
        },
      }));
    }
  };

  const scanMissingFiles = async () => {
    setMissingState("scanning");
    setMissingError(null);
    setMissingNotice(null);
    setSelectedMissing(new Set());
    try {
      const res = await fetch(
        `/api/library/maintenance/missing-files?limit=${MISSING_SCAN_LIMIT}`,
      );
      const body = (await res.json()) as MissingFilesResult & { error?: string };
      if (!res.ok) throw new Error(body?.error || `scan failed (${res.status})`);
      setMissing(body);
      // Pre-select everything found — the common case is "clean up all of these".
      setSelectedMissing(new Set(body.missing.map((m) => m.sha256)));
      setMissingState("done");
    } catch (e) {
      setMissingError(e instanceof Error ? e.message : "Scan failed");
      setMissingState("error");
    }
  };

  const toggleMissing = (sha256: string) =>
    setSelectedMissing((prev) => {
      const next = new Set(prev);
      if (next.has(sha256)) next.delete(sha256);
      else next.add(sha256);
      return next;
    });

  const toggleAllMissing = () =>
    setSelectedMissing((prev) => {
      const all = missing?.missing ?? [];
      if (prev.size === all.length) return new Set();
      return new Set(all.map((m) => m.sha256));
    });

  const deleteSelectedMissing = async () => {
    const ids = Array.from(selectedMissing);
    if (ids.length === 0) return;
    setDeletingMissing(true);
    setMissingError(null);
    setMissingNotice(null);
    try {
      const j = await fetchJson<{ deleted?: string[] }>(
        `Clean up ${ids.length} stale entr${ids.length === 1 ? "y" : "ies"}`,
        "/api/library/images/batch-delete",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
        },
      );
      const deleted = new Set(Array.isArray(j.deleted) ? j.deleted : ids);
      // Drop the cleaned-up entries from the list and the selection.
      setMissing((prev) =>
        prev
          ? {
              ...prev,
              missing: prev.missing.filter((m) => !deleted.has(m.sha256)),
              missingCount: Math.max(0, prev.missingCount - deleted.size),
            }
          : prev,
      );
      setSelectedMissing(new Set());
      setMissingNotice(`Cleaned up ${deleted.size} stale catalog entr${deleted.size === 1 ? "y" : "ies"}.`);
    } catch (e) {
      setMissingError(e instanceof Error ? e.message : "Cleanup failed");
    } finally {
      setDeletingMissing(false);
    }
  };

  const cancelJob = async (jobId: string) => {
    try {
      await fetchJson(`Cancel job ${jobId.slice(0, 8)}`, `/api/library/jobs/${jobId}/cancel`, {
        method: "POST",
      });
      refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  };

  const toggleOption = (key: keyof IngestOptions) =>
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6" data-testid="admin-page">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-ui-2xl font-semibold text-ui-ink-title">Backend Admin</h1>
          <p className="text-ui-sm text-ui-ink-muted">
            Trigger ingestion &amp; maintenance and monitor jobs.
          </p>
        </div>
        {/* Deep-link to the distributed traces (one ingest = one cross-service
            trace tree) for debugging beyond the live board. */}
        <a
          href={GRAFANA_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cls.btn}
          data-testid="grafana-link"
        >
          View traces in Grafana ↗
        </a>
      </header>

      {/* System health lives on its own page now — link across to it. */}
      <Link
        href="/admin/health"
        className={`${cls.card} flex items-center justify-between gap-3 transition hover:border-accent-cyan/60`}
        data-testid="health-link"
      >
        <span className="flex items-center gap-3">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5 shrink-0 fill-none stroke-accent-cyan"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          <span>
            <span className="block text-ui-sm font-semibold text-ui-ink-title">System Health</span>
            <span className="block text-ui-2xs text-ui-ink-muted">
              Live status, dependency readiness &amp; activity for every backend service.
            </span>
          </span>
        </span>
        <span className="shrink-0 text-ui-sm text-ui-ink-muted">View ↗</span>
      </Link>

      <Link
        href="/admin/cache"
        className={`${cls.card} flex items-center justify-between gap-3 transition hover:border-accent-cyan/60`}
        data-testid="cache-link"
      >
        <span className="flex items-center gap-3">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5 shrink-0 fill-none stroke-accent-cyan"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span>
            <span className="block text-ui-sm font-semibold text-ui-ink-title">Image Cache</span>
            <span className="block text-ui-2xs text-ui-ink-muted">
              Redis hit rate, entry counts, TTLs &amp; flush control for the thumbnail/original cache.
            </span>
          </span>
        </span>
        <span className="shrink-0 text-ui-sm text-ui-ink-muted">View ↗</span>
      </Link>

      {error && (
        <p className="text-ui-sm text-rose-500" data-testid="admin-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-ui-sm text-emerald-500" data-testid="admin-notice">
          {notice}
        </p>
      )}

      {/* Ingest */}
      <section className={cls.card} data-testid="ingest-panel">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-ui-sm font-semibold text-ui-ink-title">Ingest folder</h2>
          <button
            type="button"
            className="text-ui-2xs text-accent-cyan hover:underline"
            onClick={() => setMultiMode((m) => !m)}
            data-testid="ingest-multi-toggle"
          >
            {multiMode ? "← Single folder" : "Ingest multiple +"}
          </button>
        </div>
        {multiMode ? (
          <div className="flex flex-col gap-2">
            <textarea
              className={`${cls.input} min-h-[5rem] font-mono`}
              value={multiText}
              onChange={(e) => setMultiText(e.target.value)}
              placeholder={"One folder path per line\nK:/comfyui/output\n/mnt/share/renders"}
              spellCheck={false}
              data-testid="ingest-multi-input"
            />
            <div className="flex items-center gap-2">
              <button
                className={cls.btn}
                onClick={startIngest}
                disabled={ingestBusy}
                data-testid="ingest-start"
              >
                {ingestBusy ? "Starting…" : "Start ingestion"}
              </button>
              <span className="text-ui-2xs text-ui-ink-muted">
                {splitPaths(multiText).length} path{splitPaths(multiText).length === 1 ? "" : "s"} · one job each
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            <PathInput
              className="min-w-[14rem] flex-1"
              inputClassName={`${cls.input} flex-1`}
              buttonClassName={cls.btn}
              value={folderPath}
              onChange={setFolderPath}
              onEnter={startIngest}
              placeholder="K:/comfyui/.../ComfyUI/output"
              pickerTitle="Choose a folder to ingest"
              inputTestId="ingest-path-input"
              buttonTestId="ingest-browse"
              showPreview
            />
            <button
              className={cls.btn}
              onClick={startIngest}
              disabled={ingestBusy}
              data-testid="ingest-start"
            >
              {ingestBusy ? "Starting…" : "Start ingestion"}
            </button>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          {(Object.keys(DEFAULT_INGEST_OPTIONS) as Array<keyof IngestOptions>).map((key) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-1.5 text-ui-xs text-ui-ink"
            >
              <input
                type="checkbox"
                checked={options[key]}
                onChange={() => toggleOption(key)}
                className="rounded"
                data-testid={`ingest-opt-${key}`}
              />
              {key}
            </label>
          ))}
        </div>
      </section>

      {/* Configured source folders — persistent registry + per-folder auto-scan */}
      <SourceFoldersPanel />

      {/* Maintenance */}
      <section className={cls.card} data-testid="maintenance-panel">
        <h2 className="mb-3 text-ui-sm font-semibold text-ui-ink-title">Maintenance</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MAINTENANCE_ACTIONS.map((action) => {
            const run = runs[action.key];
            const busy = run?.status === "running";
            return (
              <div
                key={action.key}
                className="flex flex-col gap-2 rounded-lg border border-ui-border/50 bg-ui-bg p-3"
              >
                <div>
                  <p className="text-ui-sm font-medium text-ui-ink-title">{action.label}</p>
                  <p className="text-ui-2xs text-ui-ink-muted">{action.description}</p>
                </div>
                <button
                  className={cls.btn}
                  onClick={() => runMaintenance(action)}
                  disabled={busy}
                  data-testid={`maintenance-run-${action.key}`}
                >
                  {busy ? "Running…" : "Run"}
                </button>
                {run && run.status !== "running" && run.result && (
                  <p
                    className={`break-words text-ui-2xs ${
                      run.status === "error" ? "text-rose-500" : "text-emerald-500"
                    }`}
                    data-testid={`maintenance-result-${action.key}`}
                  >
                    {run.result}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Missing files — find catalog entries whose source file vanished and
          clean up the stale records. */}
      <section className={cls.card} data-testid="missing-files-panel">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-ui-sm font-semibold text-ui-ink-title">Missing files</h2>
            <p className="text-ui-2xs text-ui-ink-muted">
              Find cataloged images whose source file vanished from disk, then un-index the stale entries.
            </p>
          </div>
          <button
            className={cls.btn}
            onClick={scanMissingFiles}
            disabled={missingState === "scanning"}
            data-testid="missing-scan"
          >
            {missingState === "scanning" ? "Scanning…" : "Scan for missing files"}
          </button>
        </div>

        {missingError && (
          <p className="text-ui-sm text-rose-500" data-testid="missing-error">
            {missingError}
          </p>
        )}
        {missingNotice && (
          <p className="text-ui-sm text-emerald-500" data-testid="missing-notice">
            {missingNotice}
          </p>
        )}

        {missing && (
          <div className="mt-2 flex flex-col gap-3" data-testid="missing-results">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-2xs text-ui-ink-muted">
              <span>
                Checked <span className="tabular-nums text-ui-ink">{missing.checked}</span> · found{" "}
                <span className="tabular-nums text-ui-ink">{missing.missingCount}</span> missing
              </span>
              {missing.truncated && (
                <span className="text-amber-500">
                  showing first {missing.missing.length} — re-scan after cleanup for the rest
                </span>
              )}
            </div>

            {missing.missing.length === 0 ? (
              <p className="text-ui-sm text-emerald-500" data-testid="missing-empty">
                No missing files — every cataloged image still has its source on disk.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 text-ui-xs text-ui-ink">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selectedMissing.size === missing.missing.length && missing.missing.length > 0}
                      onChange={toggleAllMissing}
                      data-testid="missing-select-all"
                    />
                    Select all ({selectedMissing.size}/{missing.missing.length})
                  </label>
                  <button
                    className={`${cls.btn} border-rose-500/50 text-rose-500 hover:bg-rose-500/10`}
                    onClick={deleteSelectedMissing}
                    disabled={deletingMissing || selectedMissing.size === 0}
                    data-testid="missing-delete-selected"
                  >
                    {deletingMissing
                      ? "Cleaning up…"
                      : `Delete ${selectedMissing.size} selected entr${selectedMissing.size === 1 ? "y" : "ies"}`}
                  </button>
                </div>

                <ul className="flex max-h-96 flex-col gap-0.5 overflow-y-auto rounded-lg border border-ui-border/50 bg-ui-bg p-2">
                  {missing.missing.map((m) => (
                    <li key={m.sha256}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-ui-bg-soft/60">
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded"
                          checked={selectedMissing.has(m.sha256)}
                          onChange={() => toggleMissing(m.sha256)}
                          data-testid={`missing-row-${m.sha256}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ui-xs text-ui-ink" title={m.filepath}>
                            {m.filepath}
                          </span>
                          <span className="block truncate font-mono text-ui-2xs text-ui-ink-muted">
                            {m.sha256.slice(0, 16)}…
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      {/* Jobs */}
      <section className={cls.card} data-testid="jobs-panel">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-ui-sm font-semibold text-ui-ink-title">
            Ingestion jobs
            <span className="ml-2 text-ui-2xs text-ui-ink-muted">live · 3s</span>
          </h2>
          <button className={cls.btn} onClick={refreshJobs} data-testid="jobs-refresh">
            Refresh
          </button>
        </div>

        {jobs.length === 0 ? (
          <p className="text-ui-sm text-ui-ink-muted">No jobs yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {jobs.map((j) => {
              const isOpen = expanded === j.id;
              const pct = j.totalFiles > 0 ? Math.round((j.processedFiles / j.totalFiles) * 100) : 0;
              return (
                <div key={j.id} className="rounded-lg border border-ui-border/50 bg-ui-bg">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => setExpanded(isOpen ? null : j.id)}
                      data-testid={`job-row-${j.id}`}
                    >
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-ui-2xs font-medium ${jobStatusColor(j.status)}`}
                      >
                        {j.status}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ui-xs text-ui-ink">
                        {j.folderPath ?? "—"}
                      </span>
                      {ACTIVE_JOB_STATUSES.has(j.status) && j.stage && (
                        <span
                          className="shrink-0 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-ui-2xs font-medium text-sky-500"
                          title="active pipeline stage — the microservice working now"
                          data-testid={`job-stage-${j.id}`}
                        >
                          {j.stage}
                        </span>
                      )}
                      <span className="shrink-0 text-ui-2xs text-ui-ink-muted">
                        {j.processedFiles}/{j.totalFiles} ({pct}%)
                        {j.failedFiles > 0 ? ` · ${j.failedFiles} err` : ""}
                      </span>
                    </button>
                    {ACTIVE_JOB_STATUSES.has(j.status) && (
                      <button
                        className="shrink-0 rounded-md border border-rose-500/40 px-2 py-1 text-ui-2xs text-rose-500 transition hover:bg-rose-500/10"
                        onClick={() => cancelJob(j.id)}
                        data-testid={`job-cancel-${j.id}`}
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="mx-3 mb-2 h-1 overflow-hidden rounded-full bg-ui-bg-soft">
                    <div
                      className="h-full rounded-full bg-accent-cyan transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {isOpen && (
                    <div className="border-t border-ui-border/40 px-3 py-2 text-ui-2xs text-ui-ink-muted">
                      <div className="grid gap-1 sm:grid-cols-2">
                        <span>created: {j.createdAt}</span>
                        <span>started: {j.startedAt ?? "—"}</span>
                        <span>finished: {j.finishedAt ?? "—"}</span>
                        <span>job id: {j.id}</span>
                      </div>
                      {j.errorMessage && (
                        <p className="mt-1 text-rose-500">error: {j.errorMessage}</p>
                      )}
                      {/* Per-stage staircase: how far each microservice has
                          carried this job's files (which service is the
                          bottleneck / where failures stall). */}
                      {Object.keys(j.stageCounts).length > 0 && (
                        <div className="mt-2" data-testid={`job-stages-${j.id}`}>
                          <p className="font-medium text-ui-ink">Pipeline stages</p>
                          <div className="mt-1 flex flex-col gap-0.5">
                            {PIPELINE_STAGES.filter((s) => s in j.stageCounts).map((s) => {
                              const reached = j.stageCounts[s] ?? 0;
                              const w = j.totalFiles > 0 ? Math.round((reached / j.totalFiles) * 100) : 0;
                              return (
                                <div key={s} className="flex items-center gap-2">
                                  <span className="w-24 shrink-0 truncate text-ui-ink">{s}</span>
                                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-ui-bg-soft">
                                    <div
                                      className="h-full rounded-full bg-accent-cyan/70"
                                      style={{ width: `${w}%` }}
                                    />
                                  </div>
                                  <span className="w-14 shrink-0 text-right tabular-nums">
                                    {reached}/{j.totalFiles}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {detail && detail.job.id === j.id && detail.failedFiles.length > 0 && (
                        <div className="mt-2">
                          <p className="font-medium text-ui-ink">
                            Failed files ({detail.failedFiles.length})
                          </p>
                          <ul className="mt-1 flex max-h-48 flex-col gap-0.5 overflow-y-auto">
                            {detail.failedFiles.map((f) => (
                              <li key={f.filePath} className="truncate">
                                <span className="text-ui-ink">{f.filePath}</span>
                                {f.error ? ` — ${f.error}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
