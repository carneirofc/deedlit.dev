"use client";

import { useCallback, useEffect, useState } from "react";

import { PathInput } from "@/components/PathInput";

// ---------------------------------------------------------------------------
// Types mirroring the library API responses.
// ---------------------------------------------------------------------------

type ServiceState = boolean | "disabled";

interface HealthResponse {
  healthy: boolean;
  services: Record<string, ServiceState>;
}

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
}

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
];

interface ActionRun {
  status: ActionStatus;
  result: string | null;
}

function statusColor(state: ServiceState): string {
  if (state === "disabled") return "bg-ui-bg text-ui-ink-muted";
  return state
    ? "bg-emerald-500/15 text-emerald-500"
    : "bg-rose-500/15 text-rose-500";
}

function statusLabel(state: ServiceState): string {
  if (state === "disabled") return "disabled";
  return state ? "ok" : "down";
}

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
    default:
      return "bg-ui-bg text-ui-ink-muted";
  }
}

export default function AdminPage() {
  // Health
  const [health, setHealth] = useState<HealthResponse | null>(null);

  // Ingest
  const [folderPath, setFolderPath] = useState("");
  const [options, setOptions] = useState<IngestOptions>(DEFAULT_INGEST_OPTIONS);
  const [ingestBusy, setIngestBusy] = useState(false);

  // Maintenance
  const [runs, setRuns] = useState<Record<string, ActionRun>>({});

  // Jobs
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);

  // Global feedback
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshHealth = useCallback(() => {
    fetch("/api/library/health")
      .then((r) => r.json())
      .then((j: HealthResponse) => setHealth(j))
      .catch(() => setHealth(null));
  }, []);

  const refreshJobs = useCallback(() => {
    fetch("/api/library/jobs")
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.jobs)) setJobs(j.jobs as JobSummary[]);
      })
      .catch(() => {});
  }, []);

  // Initial load + polling.
  useEffect(() => {
    refreshHealth();
    refreshJobs();
    const healthId = setInterval(refreshHealth, 5000);
    const jobsId = setInterval(refreshJobs, 3000);
    return () => {
      clearInterval(healthId);
      clearInterval(jobsId);
    };
  }, [refreshHealth, refreshJobs]);

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

  const startIngest = async () => {
    const path = folderPath.trim();
    if (!path) {
      setError("Folder path is required.");
      return;
    }
    setIngestBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch("/api/library/ingest/folder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath: path, ...options }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Ingest failed");
      setNotice(`Ingestion started — job ${j.job_id}`);
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
      const r = await fetch(action.endpoint, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `${action.label} failed`);
      setRuns((prev) => ({
        ...prev,
        [action.key]: { status: "done", result: JSON.stringify(j) },
      }));
      refreshHealth();
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

  const cancelJob = async (jobId: string) => {
    try {
      const r = await fetch(`/api/library/jobs/${jobId}/cancel`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Cancel failed");
      refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  };

  const toggleOption = (key: keyof IngestOptions) =>
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6" data-testid="admin-page">
      {/* Header + health */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-ui-2xl font-semibold text-ui-ink-title">Backend Admin</h1>
          <p className="text-ui-sm text-ui-ink-muted">
            Trigger ingestion &amp; maintenance, monitor service health and jobs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid="health-badges">
          <span
            className={`rounded-full px-2 py-1 text-ui-2xs font-medium ${
              health?.healthy ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500"
            }`}
          >
            {health ? (health.healthy ? "all systems ok" : "degraded") : "checking…"}
          </span>
          {health &&
            Object.entries(health.services).map(([name, state]) => (
              <span
                key={name}
                className={`rounded-full px-2 py-1 text-ui-2xs ${statusColor(state)}`}
                data-testid={`health-${name}`}
              >
                {name} {statusLabel(state)}
              </span>
            ))}
        </div>
      </header>

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
        <h2 className="mb-3 text-ui-sm font-semibold text-ui-ink-title">Ingest folder</h2>
        <div className="flex flex-wrap gap-2">
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
