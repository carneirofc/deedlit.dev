"use client";

import { forwardRef, type ReactNode } from "react";

import { cn } from "./utils";

export type MetadataInfoBlockProps = {
  children: ReactNode;
  className?: string;
  testId?: string;
};

/**
 * A subtle info block for displaying metadata source details.
 */
const MetadataInfoBlock = forwardRef<HTMLElement, MetadataInfoBlockProps>(function MetadataInfoBlock(
  { children, className, testId },
  ref,
) {
  return (
    <section
      ref={ref}
      data-testid={testId}
      className={cn(
        "rounded-lg bg-ui-bg-code px-2 py-2 text-ui-xs text-ui-ink-secondary",
        className,
      )}
    >
      {children}
    </section>
  );
});

MetadataInfoBlock.displayName = "MetadataInfoBlock";

export default MetadataInfoBlock;
