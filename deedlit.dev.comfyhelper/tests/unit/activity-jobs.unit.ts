import { test, expect } from "@playwright/test";

import {
  applyJobToActivity,
  applyJobsToActivities,
  errorMessage,
  extractError,
  hasActiveJob,
  isTerminal,
  normalizeJob,
  TERMINAL_JOB_STATUSES,
  type Activity,
  type JobSnapshot,
} from "../../lib/store/activity-jobs";

const NOW = 1_000_000;

function jobActivity(over: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    label: "Ingest folder",
    status: "running",
    jobId: "job-1",
    progress: { processed: 0, total: 0, failed: 0 },
    startedAt: 0,
    ...over,
  };
}

function snapshot(over: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: "job-1",
    status: "running",
    totalFiles: 10,
    processedFiles: 3,
    failedFiles: 0,
    errorMessage: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// applyJobToActivity
// ---------------------------------------------------------------------------

test("copies progress and promotes pending → running", () => {
  const a = jobActivity({ status: "pending" });
  const out = applyJobToActivity(a, snapshot(), NOW);
  expect(out.status).toBe("running");
  expect(out.progress).toEqual({ processed: 3, total: 10, failed: 0 });
  expect(out.endedAt).toBeUndefined();
});

test("settles to success on a completed job", () => {
  const out = applyJobToActivity(
    jobActivity(),
    snapshot({ status: "completed", processedFiles: 10 }),
    NOW,
  );
  expect(out.status).toBe("success");
  expect(out.progress).toEqual({ processed: 10, total: 10, failed: 0 });
  expect(out.endedAt).toBe(NOW);
  expect(out.message).toBeUndefined();
});

test("settles to error with the job's message on a failed job", () => {
  const out = applyJobToActivity(
    jobActivity(),
    snapshot({ status: "failed", errorMessage: "disk full", failedFiles: 2 }),
    NOW,
  );
  expect(out.status).toBe("error");
  expect(out.message).toBe("disk full");
  expect(out.endedAt).toBe(NOW);
});

test("a cancelled job errors with a 'cancelled' fallback message", () => {
  const out = applyJobToActivity(jobActivity(), snapshot({ status: "cancelled" }), NOW);
  expect(out.status).toBe("error");
  expect(out.message).toBe("cancelled");
});

test("returns the same reference when nothing changed", () => {
  const a = jobActivity({ progress: { processed: 3, total: 10, failed: 0 } });
  const out = applyJobToActivity(a, snapshot({ processedFiles: 3 }), NOW);
  expect(out).toBe(a);
});

test("leaves already-settled activities untouched", () => {
  const a = jobActivity({ status: "success", endedAt: 5 });
  expect(applyJobToActivity(a, snapshot({ status: "running" }), NOW)).toBe(a);
});

test("leaves non-job activities untouched", () => {
  const a: Activity = { id: "x", label: "Save rating", status: "running", startedAt: 0 };
  expect(applyJobToActivity(a, snapshot(), NOW)).toBe(a);
});

test("leaves an activity whose job is absent from the list untouched", () => {
  const a = jobActivity();
  expect(applyJobToActivity(a, undefined, NOW)).toBe(a);
});

// ---------------------------------------------------------------------------
// applyJobsToActivities
// ---------------------------------------------------------------------------

test("maps each job onto its linked activity by id", () => {
  const activities: Activity[] = [
    jobActivity({ id: "a1", jobId: "job-1" }),
    jobActivity({ id: "a2", jobId: "job-2", label: "Rebuild Qdrant" }),
  ];
  const jobs = [
    snapshot({ id: "job-1", status: "completed", processedFiles: 10 }),
    snapshot({ id: "job-2", status: "running", processedFiles: 5 }),
  ];
  const out = applyJobsToActivities(activities, jobs, NOW);
  expect(out[0].status).toBe("success");
  expect(out[1].status).toBe("running");
  expect(out[1].progress).toEqual({ processed: 5, total: 10, failed: 0 });
});

test("returns the same array reference when no activity changed", () => {
  const activities = [jobActivity({ progress: { processed: 3, total: 10, failed: 0 } })];
  const jobs = [snapshot({ processedFiles: 3 })];
  expect(applyJobsToActivities(activities, jobs, NOW)).toBe(activities);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

test("hasActiveJob is true only for an unsettled job-linked activity", () => {
  expect(hasActiveJob([jobActivity()])).toBe(true);
  expect(hasActiveJob([jobActivity({ status: "success" })])).toBe(false);
  expect(hasActiveJob([{ id: "x", label: "y", status: "running", startedAt: 0 }])).toBe(false);
  expect(hasActiveJob([])).toBe(false);
});

test("isTerminal and the terminal status set", () => {
  expect(isTerminal("success")).toBe(true);
  expect(isTerminal("error")).toBe(true);
  expect(isTerminal("running")).toBe(false);
  expect(TERMINAL_JOB_STATUSES.has("completed")).toBe(true);
  expect(TERMINAL_JOB_STATUSES.has("running")).toBe(false);
});

test("normalizeJob coerces fields and tolerates junk", () => {
  expect(
    normalizeJob({
      id: "job-9",
      status: "running",
      totalFiles: 4,
      processedFiles: 2,
      failedFiles: 1,
      errorMessage: "x",
    }),
  ).toEqual({
    id: "job-9",
    status: "running",
    totalFiles: 4,
    processedFiles: 2,
    failedFiles: 1,
    errorMessage: "x",
  });

  expect(normalizeJob(null)).toEqual({
    id: "",
    status: "unknown",
    totalFiles: 0,
    processedFiles: 0,
    failedFiles: 0,
    errorMessage: null,
  });
});

test("errorMessage extracts from Error / string / fallback", () => {
  expect(errorMessage(new Error("boom"))).toBe("boom");
  expect(errorMessage("nope")).toBe("nope");
  expect(errorMessage({})).toBe("failed");
});

test("extractError prefers body.error/detail/message then falls back to status", () => {
  const res = { status: 500, statusText: "Internal Server Error" };
  expect(extractError({ error: "bad" }, res)).toBe("bad");
  expect(extractError({ detail: "nope" }, res)).toBe("nope");
  expect(extractError({ message: "hmm" }, res)).toBe("hmm");
  expect(extractError(undefined, res)).toBe("500 Internal Server Error");
});
