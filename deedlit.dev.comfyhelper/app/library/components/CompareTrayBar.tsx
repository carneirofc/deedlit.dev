"use client";

import Link from "next/link";

import { useCompareTray } from "@/lib/store/compare-tray";

/** Floating bar showing images queued for comparison; opens /library/compare. */
export function CompareTrayBar() {
  const tray = useCompareTray();
  if (tray.ids.length === 0) return null;

  const canCompare = tray.ids.length >= 2;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-70 flex justify-center px-3 md:bottom-4 md:pl-24">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-ui-border/70 bg-ui-bg/95 p-2.5 shadow-panel-lg backdrop-blur-xl">
        <span className="hidden px-1 text-ui-xs text-ui-ink-muted sm:block">Compare</span>
        <div className="flex items-center gap-1.5">
          {tray.ids.map((id) => (
            <div key={id} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/library/images/${id}/thumbnail`}
                alt=""
                className="h-11 w-11 rounded-lg border border-ui-border/60 object-cover"
              />
              <button
                onClick={() => tray.remove(id)}
                className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full border border-ui-border/70 bg-ui-bg text-ui-2xs text-ui-ink-muted transition hover:text-rose-500"
                aria-label="Remove from comparison"
              >
                ×
              </button>
            </div>
          ))}
          {Array.from({ length: tray.max - tray.ids.length }).map((_, i) => (
            <div
              key={`slot-${i}`}
              className="h-11 w-11 rounded-lg border border-dashed border-ui-border/50"
              aria-hidden="true"
            />
          ))}
        </div>
        <button
          onClick={tray.clear}
          className="rounded-lg border border-ui-border/70 px-2.5 py-2 text-ui-xs text-ui-ink-muted transition hover:text-ui-ink"
        >
          Clear
        </button>
        <Link
          href={`/library/compare?ids=${tray.ids.join(",")}`}
          prefetch={false}
          aria-disabled={!canCompare}
          tabIndex={canCompare ? undefined : -1}
          className={`rounded-lg px-3 py-2 text-ui-xs font-medium transition ${
            canCompare
              ? "bg-accent-cyan text-ui-bg-deep hover:opacity-90"
              : "pointer-events-none border border-ui-border/50 text-ui-ink-muted opacity-50"
          }`}
        >
          Compare {tray.ids.length}
        </Link>
      </div>
    </div>
  );
}
