"use client";

import { useEffect, useState } from "react";

export type ActivityStatus = "pending" | "running" | "success" | "error";

export interface ActivityProgress {
  processed: number;
  total: number;
  failed: number;
}

/**
 * Presentational shape consumed by {@link ActivityDock} / {@link ActivityToasts}.
 * Apps may store a richer activity (extra fields like `jobId`, `startedAt`) — it
 * stays structurally assignable to this type.
 */
export interface Activity {
  id: string;
  /** Human label shown in the dock, e.g. "Ingest folder", "Save rating". */
  label: string;
  status: ActivityStatus;
  /** Determinate progress — only present for job-linked activities. */
  progress?: ActivityProgress;
  /** Error text (on `error`) or short result detail. */
  message?: string;
  /** Current pipeline stage of a live activity — the worker doing work now. */
  stage?: string | null;
  /** Epoch ms when the activity settled; drives toast TTL expiry. */
  endedAt?: number;
}

function statusChip(status: ActivityStatus): string {
  switch (status) {
    case "pending":
    case "running":
      return "bg-sky-500/15 text-sky-500";
    case "success":
      return "bg-emerald-500/15 text-emerald-500";
    case "error":
      return "bg-rose-500/15 text-rose-500";
  }
}

function statusLabel(status: ActivityStatus): string {
  switch (status) {
    case "pending":
      return "queued";
    case "running":
      return "running";
    case "success":
      return "done";
    case "error":
      return "failed";
  }
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

function pct(a: Activity): number | null {
  if (!a.progress || a.progress.total <= 0) return null;
  return Math.min(100, Math.round((a.progress.processed / a.progress.total) * 100));
}

function ActivityRow({ a, onDismiss }: { a: Activity; onDismiss: (id: string) => void }) {
  const active = a.status === "pending" || a.status === "running";
  const percent = pct(a);

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-ui-border/50 bg-ui-bg p-2.5"
      data-testid={`activity-row-${a.status}`}
    >
      <div className="flex items-center gap-2">
        {active ? (
          <Spinner className="h-3 w-3 shrink-0 text-sky-500" />
        ) : (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              a.status === "success" ? "bg-emerald-500" : "bg-rose-500"
            }`}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-ui-xs text-ui-ink" title={a.label}>
          {a.label}
        </span>
        {active && a.stage && (
          <span
            className="shrink-0 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-ui-2xs font-medium text-sky-500"
            title="active pipeline stage — the microservice working now"
            data-testid="activity-stage"
          >
            {a.stage}
          </span>
        )}
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-ui-2xs font-medium ${statusChip(a.status)}`}>
          {statusLabel(a.status)}
        </span>
        <button
          onClick={() => onDismiss(a.id)}
          className="shrink-0 rounded text-ui-2xs text-ui-ink-muted transition hover:text-ui-ink"
          aria-label="Dismiss"
          data-testid={`activity-dismiss-${a.id}`}
        >
          ×
        </button>
      </div>

      {/* Determinate bar for job-linked work; thin indeterminate sliver otherwise. */}
      {percent !== null ? (
        <div className="flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-ui-bg-soft">
            <div
              className="h-full rounded-full bg-accent-cyan transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="shrink-0 text-ui-2xs tabular-nums text-ui-ink-muted">
            {a.progress!.processed}/{a.progress!.total} ({percent}%)
            {a.progress!.failed > 0 ? ` · ${a.progress!.failed} err` : ""}
          </span>
        </div>
      ) : active ? (
        <div className="h-1 overflow-hidden rounded-full bg-ui-bg-soft">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent-cyan/70" />
        </div>
      ) : null}

      {a.status === "error" && a.message && (
        <p className="break-words text-ui-2xs text-rose-500">{a.message}</p>
      )}
    </div>
  );
}

export type ActivityDockProps = {
  activities: Activity[];
  onDismiss: (id: string) => void;
  onClearFinished: () => void;
};

/**
 * Floating, always-mounted activity dock (bottom-right). Shows a pill with an
 * in-flight count whenever a tracked interaction is running, and an expandable
 * panel listing each operation with live progress; errors stick until dismissed.
 * Presentational — the app owns the activity store and passes it in.
 */
export function ActivityDock({ activities, onDismiss, onClearFinished }: ActivityDockProps) {
  const [open, setOpen] = useState(false);

  if (activities.length === 0) return null;

  const active = activities.filter((a) => a.status === "pending" || a.status === "running").length;
  const errors = activities.filter((a) => a.status === "error").length;
  const finished = activities.filter((a) => a.status === "success" || a.status === "error").length;

  const pillLabel =
    active > 0
      ? `${active} running`
      : errors > 0
        ? `${errors} issue${errors === 1 ? "" : "s"}`
        : "idle";

  return (
    <div className="fixed bottom-4 right-4 z-80 flex w-[min(22rem,calc(100vw-2rem))] flex-col items-end gap-2">
      {open && (
        <section
          className="w-full rounded-xl border border-ui-border/70 bg-ui-bg/95 p-3 shadow-panel-lg backdrop-blur-xl"
          data-testid="activity-panel"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-ui-xs font-semibold text-ui-ink-title">Activity</h2>
            {finished > 0 && (
              <button
                onClick={onClearFinished}
                className="rounded-md border border-ui-border/70 px-2 py-0.5 text-ui-2xs text-ui-ink-muted transition hover:bg-accent-cyan/10"
                data-testid="activity-clear"
              >
                Clear finished
              </button>
            )}
          </div>
          <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
            {activities.map((a) => (
              <ActivityRow key={a.id} a={a} onDismiss={onDismiss} />
            ))}
          </div>
        </section>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-ui-border/70 bg-ui-bg/95 px-3 py-2 text-ui-xs font-medium shadow-panel-lg backdrop-blur-xl transition hover:border-accent-cyan/60"
        data-testid="activity-pill"
        aria-expanded={open}
      >
        {active > 0 ? (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        ) : errors > 0 ? (
          <span className="h-2 w-2 rounded-full bg-rose-500" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
        )}
        <span className={errors > 0 && active === 0 ? "text-rose-500" : "text-ui-ink"}>{pillLabel}</span>
      </button>
    </div>
  );
}

const SUCCESS_TTL_MS = 3500;
const ERROR_TTL_MS = 8000;

export type ActivityToastsProps = {
  activities: Activity[];
  /** Override the auto-dismiss windows (ms) for settled activities. */
  successTtlMs?: number;
  errorTtlMs?: number;
};

/**
 * The "glance" layer over {@link ActivityDock}: a transient toast appears when a
 * tracked interaction settles — brief on success, longer on error. Toasts are
 * derived from `endedAt` (not stored), so there is no effect-driven state to
 * keep in sync; a slow tick re-renders so live toasts expire on time.
 */
export function ActivityToasts({
  activities,
  successTtlMs = SUCCESS_TTL_MS,
  errorTtlMs = ERROR_TTL_MS,
}: ActivityToastsProps) {
  const [now, setNow] = useState(() => Date.now());

  const toasts = activities
    .filter((a) => {
      if ((a.status !== "success" && a.status !== "error") || a.endedAt === undefined) return false;
      const ttl = a.status === "error" ? errorTtlMs : successTtlMs;
      return now - a.endedAt < ttl;
    })
    .slice(0, 4);

  const hasLive = toasts.length > 0;
  useEffect(() => {
    if (!hasLive) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [hasLive]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-90 flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-[20rem] items-start gap-2 rounded-lg border px-3 py-2 text-ui-xs shadow-panel-lg backdrop-blur-xl ${
            t.status === "success"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400"
          }`}
          data-testid={`activity-toast-${t.status}`}
        >
          <span className="mt-0.5 shrink-0">{t.status === "success" ? "✓" : "✕"}</span>
          <span className="min-w-0">
            <span className="font-medium">{t.label}</span>
            {t.status === "error" && t.message ? (
              <span className="block break-words opacity-90">{t.message}</span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
