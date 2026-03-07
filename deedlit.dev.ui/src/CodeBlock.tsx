"use client";

import { forwardRef, type ReactNode } from "react";

import { cn } from "./utils";

export type CodeBlockProps = {
  children: ReactNode;
  /** Maximum height before scrolling (default: "max-h-[65vh]") */
  maxHeight?: string;
  className?: string;
  testId?: string;
};

/**
 * Scrollable preformatted code/text block with dark background.
 */
const CodeBlock = forwardRef<HTMLPreElement, CodeBlockProps>(function CodeBlock(
  { children, maxHeight = "max-h-[65vh]", className, testId },
  ref,
) {
  return (
    <pre
      ref={ref}
      data-testid={testId}
      className={cn(
        "overflow-auto rounded-lg bg-ui-bg-deep p-2 text-ui-xs text-ui-ink-inverse",
        maxHeight,
        className,
      )}
    >
      {children}
    </pre>
  );
});

CodeBlock.displayName = "CodeBlock";

export default CodeBlock;
