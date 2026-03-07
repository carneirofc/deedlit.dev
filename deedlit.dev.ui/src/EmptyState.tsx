"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "./utils";

export type EmptyStateTone = "default" | "subtle";

export type EmptyStateProps = HTMLAttributes<HTMLParagraphElement> & {
  children: ReactNode;
  tone?: EmptyStateTone;
  testId?: string;
};

const TONE_CLASS_NAMES: Record<EmptyStateTone, string> = {
  default:
    "rounded-xl border border-dashed border-ui-soft p-4 text-ui-sm text-[color:var(--ui-ink-subtle)]",
  subtle: "text-ui-sm text-[color:var(--ui-ink-subtle)]",
};

const EmptyState = forwardRef<HTMLParagraphElement, EmptyStateProps>(
  function EmptyState({ children, tone = "default", testId, className, ...props }, ref) {
    return (
      <p
        ref={ref}
        id={testId}
        data-testid={testId}
        className={cn(TONE_CLASS_NAMES[tone], className)}
        {...props}
      >
        {children}
      </p>
    );
  },
);

EmptyState.displayName = "EmptyState";

export default EmptyState;
