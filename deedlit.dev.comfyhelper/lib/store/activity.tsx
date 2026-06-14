"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  applyJobsToActivities,
  errorMessage,
  extractError,
  hasActiveJob,
  isTerminal,
  normalizeJob,
  type Activity,
  type JobSnapshot,
} from "@/lib/store/activity-jobs";

export type { Activity, ActivityStatus, ActivityProgress } from "@/lib/store/activity-jobs";

// ---------------------------------------------------------------------------
// Tunables.
// ---------------------------------------------------------------------------

/** Jobs-poll cadence while a job-linked activity is in flight. */
const POLL_MS = 2000;
/** How long a succeeded row lingers in the dock before it auto-prunes. */
const PRUNE_SUCCESS_MS = 4000;
/** Cap on retained rows so a long session can't grow unbounded. */
const MAX_ROWS = 40;

// Monotonic activity ids (module-scoped, never reused, SSR-safe).
let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `act-${idCounter}`;
}

// ---------------------------------------------------------------------------
// Context value.
// ---------------------------------------------------------------------------

interface ActivityValue {
  /** Newest-first list of tracked backend interactions. */
  activities: Activity[];
  /** Latest polled jobs snapshot (shared so pages need not re-poll). */
  jobs: JobSnapshot[];
  jobsLoading: boolean;
  /**
   * Wrap a one-shot mutation: pushes a running row, then marks it
   * success/error when `fn` settles. Re-throws so callers keep their own
   * try/catch. Returns whatever `fn` resolves to.
   */
  track: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  /**
   * `track` + fetch + JSON: does the fetch, ok-check and error-detail
   * extraction in one call. Throws on a non-2xx response.
   */
  fetchJson: <T = unknown>(label: string, input: RequestInfo | URL, init?: RequestInit) => Promise<T>;
  /** Register a job-linked row the poller will drive to completion. No-op if jobId is falsy. */
  trackJob: (label: string, jobId: string | null | undefined) => void;
  /** Remove one row from the dock. */
  dismiss: (id: string) => void;
  /** Remove every settled (success/error) row. */
  clearFinished: () => void;
}

const ActivityContext = createContext<ActivityValue | null>(null);

// ---------------------------------------------------------------------------
// Provider.
// ---------------------------------------------------------------------------

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  const push = useCallback((a: Activity) => {
    setActivities((prev) => [a, ...prev].slice(0, MAX_ROWS));
  }, []);

  const patch = useCallback((id: string, fields: Partial<Activity>) => {
    setActivities((prev) => prev.map((a) => (a.id === id ? { ...a, ...fields } : a)));
  }, []);

  const track = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
      const id = nextId();
      push({ id, label, status: "running", startedAt: Date.now() });
      try {
        const result = await fn();
        patch(id, { status: "success", endedAt: Date.now() });
        return result;
      } catch (e) {
        patch(id, { status: "error", message: errorMessage(e), endedAt: Date.now() });
        throw e;
      }
    },
    [push, patch],
  );

  const fetchJson = useCallback(
    <T = unknown,>(label: string, input: RequestInfo | URL, init?: RequestInit): Promise<T> =>
      track(label, async () => {
        const res = await fetch(input, init);
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          body = undefined;
        }
        if (!res.ok) throw new Error(extractError(body, res));
        return body as T;
      }),
    [track],
  );

  const trackJob = useCallback(
    (label: string, jobId: string | null | undefined) => {
      if (!jobId) return;
      push({
        id: nextId(),
        label,
        status: "running",
        jobId,
        progress: { processed: 0, total: 0, failed: 0 },
        startedAt: Date.now(),
      });
    },
    [push],
  );

  const dismiss = useCallback((id: string) => {
    setActivities((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setActivities((prev) => prev.filter((a) => !isTerminal(a.status)));
  }, []);

  // --- Jobs poller: runs only while a job-linked activity is unsettled. ------
  const polling = hasActiveJob(activities);
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const poll = async () => {
      setJobsLoading(true);
      try {
        const res = await fetch("/api/library/jobs", { cache: "no-store" });
        const j: unknown = await res.json();
        const list = Array.isArray((j as { jobs?: unknown[] })?.jobs)
          ? (j as { jobs: unknown[] }).jobs.map(normalizeJob)
          : [];
        if (cancelled) return;
        setJobs(list);
        setActivities((prev) => applyJobsToActivities(prev, list, Date.now()));
      } catch {
        // transient; the next tick retries.
      } finally {
        if (!cancelled) setJobsLoading(false);
      }
    };
    void poll();
    const handle = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [polling]);

  // --- Auto-prune succeeded rows after a short linger. -----------------------
  const pruneTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const timers = pruneTimers.current;
    for (const a of activities) {
      if (a.status === "success" && !timers.has(a.id)) {
        const handle = setTimeout(() => {
          timers.delete(a.id);
          setActivities((prev) => prev.filter((x) => x.id !== a.id));
        }, PRUNE_SUCCESS_MS);
        timers.set(a.id, handle);
      }
    }
  }, [activities]);
  useEffect(() => {
    const timers = pruneTimers.current;
    return () => {
      for (const handle of timers.values()) clearTimeout(handle);
    };
  }, []);

  const value = useMemo<ActivityValue>(
    () => ({
      activities,
      jobs,
      jobsLoading,
      track,
      fetchJson,
      trackJob,
      dismiss,
      clearFinished,
    }),
    [activities, jobs, jobsLoading, track, fetchJson, trackJob, dismiss, clearFinished],
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity(): ActivityValue {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error("useActivity must be used within ActivityProvider");
  return ctx;
}
