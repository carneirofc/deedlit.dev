/**
 * Pure activity/job logic — no React, no JSX. Lives apart from the provider
 * (`activity.tsx`) so the job→activity reducer and the small helpers can be
 * unit-tested in the Playwright node runner without pulling in React.
 *
 * An "activity" is one tracked backend interaction the UI surfaces in the
 * global Activity dock. Long-running activities are linked to a backend job by
 * `jobId`; the provider polls `GET /api/library/jobs` and folds each job
 * snapshot back onto its activity with {@link applyJobsToActivities}.
 */

export type ActivityStatus = "pending" | "running" | "success" | "error";

export interface ActivityProgress {
  processed: number;
  total: number;
  failed: number;
}

export interface Activity {
  /** Client-generated, monotonic, never reused. */
  id: string;
  /** Human label shown in the dock, e.g. "Ingest folder", "Save rating". */
  label: string;
  status: ActivityStatus;
  /** Determinate progress — only present for job-linked activities. */
  progress?: ActivityProgress;
  /** Error text (on `error`) or short result detail. */
  message?: string;
  /** Links the activity to a backend job so the poller can drive it. */
  jobId?: string;
  startedAt: number;
  endedAt?: number;
}

/** The subset of a normalized `/api/library/jobs` row the reducer needs. */
export interface JobSnapshot {
  id: string;
  status: string;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  errorMessage: string | null;
}

/** Job statuses past which an activity is settled and no longer driven. */
export const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

/** True once an activity has settled (succeeded or failed). */
export function isTerminal(status: ActivityStatus): boolean {
  return status === "success" || status === "error";
}

/**
 * Fold a single job snapshot onto its activity. Returns the SAME reference when
 * nothing changes so React can skip re-renders. An already-settled activity, or
 * one whose job has not appeared in the jobs list yet, is returned untouched.
 */
export function applyJobToActivity(
  activity: Activity,
  job: JobSnapshot | undefined,
  now: number,
): Activity {
  if (!activity.jobId || isTerminal(activity.status) || !job) return activity;

  const progress: ActivityProgress = {
    processed: job.processedFiles,
    total: job.totalFiles,
    failed: job.failedFiles,
  };

  if (TERMINAL_JOB_STATUSES.has(job.status)) {
    const ok = job.status === "completed";
    return {
      ...activity,
      progress,
      status: ok ? "success" : "error",
      message: ok
        ? undefined
        : job.errorMessage ?? (job.status === "cancelled" ? "cancelled" : "failed"),
      endedAt: now,
    };
  }

  // Still in flight: surface latest counts and promote pending → running.
  const same =
    activity.status === "running" &&
    activity.progress?.processed === progress.processed &&
    activity.progress?.total === progress.total &&
    activity.progress?.failed === progress.failed;
  if (same) return activity;
  return { ...activity, status: "running", progress };
}

/**
 * Fold a fresh jobs list onto every job-linked activity. Returns the SAME array
 * reference when no activity changed (lets the provider bail out of a setState).
 */
export function applyJobsToActivities(
  activities: Activity[],
  jobs: JobSnapshot[],
  now: number,
): Activity[] {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  let changed = false;
  const next = activities.map((a) => {
    const updated = applyJobToActivity(a, a.jobId ? byId.get(a.jobId) : undefined, now);
    if (updated !== a) changed = true;
    return updated;
  });
  return changed ? next : activities;
}

/** True when at least one activity is job-linked and not yet settled. */
export function hasActiveJob(activities: Activity[]): boolean {
  return activities.some((a) => Boolean(a.jobId) && !isTerminal(a.status));
}

/** Normalize one opaque `/api/library/jobs` row into a {@link JobSnapshot}. */
export function normalizeJob(raw: unknown): JobSnapshot {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    id: typeof o.id === "string" ? o.id : "",
    status: typeof o.status === "string" ? o.status : "unknown",
    totalFiles: num(o.totalFiles),
    processedFiles: num(o.processedFiles),
    failedFiles: num(o.failedFiles),
    errorMessage: typeof o.errorMessage === "string" ? o.errorMessage : null,
  };
}

/** Best-effort human message from a thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return "failed";
}

/** Pull an error string out of a JSON error body, falling back to the status. */
export function extractError(body: unknown, res: { status: number; statusText: string }): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const m = o.error ?? o.detail ?? o.message;
    if (typeof m === "string" && m) return m;
  }
  return `${res.status} ${res.statusText}`.trim() || "request failed";
}
