"use client";

import { forwardRef, useEffect, useMemo, useState } from "react";

import { cn } from "./utils";

export type ScanProgressProps = {
  title?: string;
  rootCount?: number;
  className?: string;
  progressPercent?: number;
  processedCount?: number;
  totalCount?: number;
  statusLabel?: string;
  /** Custom stage labels shown during indeterminate progress based on elapsed time. */
  stageLabels?: readonly string[];
  testId?: string;
};

const DEFAULT_SCAN_STAGE_LABELS = [
  "Preparing roots",
  "Walking directories recursively",
  "Reading sidecar JSON metadata",
  "Extracting embedded PNG metadata",
  "Finalizing image index",
] as const;

function getStageIndex(elapsedSeconds: number): number {
  if (elapsedSeconds < 2) {
    return 0;
  }

  if (elapsedSeconds < 5) {
    return 1;
  }

  if (elapsedSeconds < 8) {
    return 2;
  }

  if (elapsedSeconds < 12) {
    return 3;
  }

  return 4;
}

export { DEFAULT_SCAN_STAGE_LABELS };

const ScanProgress = forwardRef<HTMLDivElement, ScanProgressProps>(function ScanProgress({
  title = "Scanning image library",
  rootCount,
  className,
  progressPercent,
  processedCount,
  totalCount,
  statusLabel,
  stageLabels,
  testId,
}, ref) {
  const [progress, setProgress] = useState(8);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const hasExternalProgress = typeof progressPercent === "number" && Number.isFinite(progressPercent);

  useEffect(() => {
    if (hasExternalProgress) {
      return;
    }

    const startedAt = Date.now();

    const interval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setElapsedSeconds(elapsed);
      setProgress((previous) => {
        const remaining = 94 - previous;
        const step = Math.max(0.28, remaining * 0.08);
        return Math.min(94, previous + step);
      });
    }, 220);

    return () => {
      window.clearInterval(interval);
    };
  }, [hasExternalProgress]);

  const resolvedStageLabels = stageLabels ?? DEFAULT_SCAN_STAGE_LABELS;
  const stageIndex = useMemo(() => getStageIndex(elapsedSeconds), [elapsedSeconds]);
  const stageLabel = resolvedStageLabels[stageIndex] ?? resolvedStageLabels[resolvedStageLabels.length - 1] ?? "";
  const displayProgress = hasExternalProgress
    ? Math.max(0, Math.min(100, Math.floor(progressPercent)))
    : Math.max(8, Math.floor(progress));
  const rootSummary =
    typeof rootCount === "number" && rootCount > 0
      ? `${rootCount} ${rootCount === 1 ? "root" : "roots"} configured`
      : "Preparing configured roots";
  const countSummary =
    typeof processedCount === "number" && typeof totalCount === "number" && totalCount > 0
      ? `${processedCount}/${totalCount} files`
      : null;

  return (
    <div
      ref={ref}
      data-testid={testId}
      className={cn("cyber-subpanel rounded-2xl px-3 py-3", className)}
      role="status"
      aria-live="polite"
      aria-label="Scan progress"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ui-sm font-semibold text-[color:var(--text-0)]">{title}</p>
        <span className="cyber-chip rounded-full px-2 py-0.5 text-ui-xs font-medium">
          {displayProgress}%
        </span>
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[color:color-mix(in_oklab,var(--surface-1)_84%,transparent)]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,color-mix(in_oklab,var(--accent-cyan)_80%,#001f2b)_0%,color-mix(in_oklab,var(--accent-pink)_78%,#220025)_58%,color-mix(in_oklab,var(--accent-lime)_72%,#02281b)_100%)] transition-[width] duration-300"
          style={{ width: `${displayProgress}%` }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-ui-xs text-[color:var(--text-2)]">
        <span>{countSummary ?? rootSummary}</span>
        <span>{hasExternalProgress ? `${displayProgress}%` : `${elapsedSeconds}s elapsed`}</span>
      </div>

      <p className="mt-1 text-ui-xs text-[color:var(--text-1)]">{statusLabel ?? stageLabel}</p>
    </div>
  );
});

ScanProgress.displayName = "ScanProgress";

export default ScanProgress;

