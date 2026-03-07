"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import CopyButton from "./CopyButton";
import SectionLabel from "./SectionLabel";
import { cn } from "./utils";

export type PromptBlockTone = "positive" | "negative" | "neutral";

export type PromptBlockProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  /** Section heading displayed above the prompt text. */
  label: ReactNode;
  /** The prompt text. */
  children: ReactNode;
  /** Visual tone controlling the background colour of the text area. */
  tone?: PromptBlockTone;
  /** Whether the copy button shows "Copied" state. */
  copied?: boolean;
  /** Called when the copy button is clicked. */
  onCopy?: () => void;
};

const TONE_CLASSES: Record<PromptBlockTone, string> = {
  positive: "bg-success",
  negative: "bg-error",
  neutral: "bg-[color:var(--ui-bg-soft)]",
};

/**
 * Labelled prompt display block with a copy button.
 *
 * ```tsx
 * <PromptBlock label="Positive Prompt" tone="positive" copied={copied} onCopy={handleCopy}>
 *   {text}
 * </PromptBlock>
 * ```
 */
const PromptBlock = forwardRef<HTMLElement, PromptBlockProps>(
  function PromptBlock({ label, children, tone = "neutral", copied, onCopy, className, ...props }, ref) {
    return (
      <section ref={ref} className={className} {...props}>
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>{label}</SectionLabel>
          {onCopy && <CopyButton copied={copied} onClick={onCopy} />}
        </div>
        <pre
          className={cn(
            "mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg p-2 text-ui-xs text-[color:var(--ui-ink-primary)]",
            TONE_CLASSES[tone],
          )}
        >
          {children}
        </pre>
      </section>
    );
  },
);

PromptBlock.displayName = "PromptBlock";

export default PromptBlock;
