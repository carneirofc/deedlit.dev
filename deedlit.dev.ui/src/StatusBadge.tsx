"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

export type StatusBadgeTone = "neutral" | "success" | "warn" | "error";

export const statusBadgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-ui-2xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-ink",
        success: "bg-emerald-100 text-emerald-700",
        warn: "bg-amber-100 text-amber-700",
        error: "bg-rose-100 text-rose-700",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof statusBadgeVariants>;

const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(function StatusBadge(
  { className, tone, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      data-slot="status-badge"
      className={cn(statusBadgeVariants({ tone }), className)}
      {...props}
    />
  );
});

StatusBadge.displayName = "StatusBadge";

export default StatusBadge;
