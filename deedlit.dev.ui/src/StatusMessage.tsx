"use client";

import { forwardRef, type ReactNode } from "react";

import { cn, SPACING_PATTERNS } from "./utils";

export type StatusTone = "info" | "warn" | "error" | "success";

export type StatusMessageProps = {
  testId?: string;
  role: "status" | "alert";
  tone: StatusTone;
  children: ReactNode;
  className?: string;
};

const TONE_CLASSES: Record<StatusTone, string> = {
  error: "border-error-edge bg-error text-error-ink",
  warn: "border-warn-edge bg-warn text-warn-ink",
  success: "border-success-edge bg-success text-success-ink",
  info: "border-ui bg-[color:var(--surface-0)] text-[color:var(--ui-ink-muted)]",
};

const StatusMessage = forwardRef<HTMLParagraphElement, StatusMessageProps>(function StatusMessage(
  { testId, role, tone, children, className },
  ref,
) {
  const baseClass = cn("rounded-xl border text-ui-sm", SPACING_PATTERNS.controlMd);

  return (
    <p
      ref={ref}
      id={testId}
      data-testid={testId}
      role={role}
      aria-live={role === "status" ? "polite" : undefined}
      className={cn(baseClass, TONE_CLASSES[tone], className)}
    >
      {children}
    </p>
  );
});

export default StatusMessage;

