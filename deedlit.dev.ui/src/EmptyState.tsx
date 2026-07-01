"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

export type EmptyStateTone = "default" | "subtle";

export const emptyStateVariants = cva("text-ui-sm text-[color:var(--ui-ink-subtle)]", {
  variants: {
    tone: {
      default: "rounded-xl border border-dashed border-ui-soft p-4",
      subtle: "",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

export type EmptyStateProps = HTMLAttributes<HTMLParagraphElement> &
  VariantProps<typeof emptyStateVariants> & {
    children: ReactNode;
    testId?: string;
  };

const EmptyState = forwardRef<HTMLParagraphElement, EmptyStateProps>(
  function EmptyState({ children, tone, testId, className, ...props }, ref) {
    return (
      <p
        ref={ref}
        id={testId}
        data-testid={testId}
        data-slot="empty-state"
        className={cn(emptyStateVariants({ tone }), className)}
        {...props}
      >
        {children}
      </p>
    );
  },
);

EmptyState.displayName = "EmptyState";

export default EmptyState;
