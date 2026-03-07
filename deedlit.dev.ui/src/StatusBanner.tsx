"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "./utils";

export type StatusBannerTone = "loading" | "error";

export type StatusBannerProps = HTMLAttributes<HTMLParagraphElement> & {
  tone: StatusBannerTone;
  children: ReactNode;
};

const TONE_CLASSES: Record<StatusBannerTone, string> = {
  loading:
    "border-[color:var(--ui-border)] bg-[color:var(--ui-bg-soft)] text-[color:var(--ui-ink-secondary)]",
  error: "border-error-edge bg-error text-error-ink",
};

/**
 * Compact inline status banner for loading / error states inside panels.
 *
 * ```tsx
 * {isLoading && <StatusBanner tone="loading">Loading metadata…</StatusBanner>}
 * {error     && <StatusBanner tone="error">{error}</StatusBanner>}
 * ```
 */
const StatusBanner = forwardRef<HTMLParagraphElement, StatusBannerProps>(
  function StatusBanner({ tone, children, className, ...props }, ref) {
    return (
      <p
        ref={ref}
        role={tone === "error" ? "alert" : "status"}
        className={cn(
          "rounded-lg border px-2 py-2 text-ui-xs",
          TONE_CLASSES[tone],
          className,
        )}
        {...props}
      >
        {children}
      </p>
    );
  },
);

StatusBanner.displayName = "StatusBanner";

export default StatusBanner;
