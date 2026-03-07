"use client";

import { forwardRef, type HTMLAttributes } from "react";

import { cn, SPACING_PATTERNS } from "./utils";

export type StatusBadgeTone = "neutral" | "success" | "warn" | "error";

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusBadgeTone;
};

const TONE_CLASS_NAMES: Record<StatusBadgeTone, string> = {
  neutral: "bg-muted text-muted-ink",
  success: "bg-emerald-100 text-emerald-700",
  warn: "bg-amber-100 text-amber-700",
  error: "bg-rose-100 text-rose-700",
};

const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(function StatusBadge(
  { className, tone = "neutral", ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn("inline-flex items-center rounded-full text-ui-2xs font-medium", SPACING_PATTERNS.badgeStandard, TONE_CLASS_NAMES[tone], className)}
      {...props}
    />
  );
});

export default StatusBadge;
