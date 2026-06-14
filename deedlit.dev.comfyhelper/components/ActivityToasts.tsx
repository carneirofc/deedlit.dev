"use client";

import { useEffect, useState } from "react";

import { useActivity } from "@/lib/store/activity";

const SUCCESS_TTL_MS = 3500;
const ERROR_TTL_MS = 8000;

/**
 * The "glance" layer over the activity dock: a transient toast shows when a
 * tracked interaction settles — brief on success, longer on error. Toasts are
 * derived (not stored): a settled activity surfaces a toast while it is still
 * within its TTL window (measured from `endedAt`), so there is no effect-driven
 * state to keep in sync. A slow tick re-renders so live toasts expire on time.
 * The dock remains the source of truth; toasts just catch completions the user
 * isn't watching the dock for. Mounted once alongside the dock.
 */
export function ActivityToasts() {
  const { activities } = useActivity();
  const [now, setNow] = useState(() => Date.now());

  const toasts = activities
    .filter((a) => {
      if ((a.status !== "success" && a.status !== "error") || a.endedAt === undefined) return false;
      const ttl = a.status === "error" ? ERROR_TTL_MS : SUCCESS_TTL_MS;
      return now - a.endedAt < ttl;
    })
    .slice(0, 4);

  // Tick only while a toast is live so they auto-expire; idle otherwise.
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
