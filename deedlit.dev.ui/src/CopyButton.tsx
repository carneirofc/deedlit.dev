"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import OutlineButton from "./OutlineButton";
import { CopyIcon } from "./Icons";
import { cn } from "./utils";

export type CopyButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** Label shown when idle. @default "Copy" */
  label?: ReactNode;
  /** Label shown after a successful copy. @default "Copied" */
  copiedLabel?: ReactNode;
  /** Whether the copy action has just completed (drives label swap). */
  copied?: boolean;
};

/**
 * Small outline button with a clipboard copy icon.
 *
 * ```tsx
 * <CopyButton copied={copied} onClick={handleCopy} />
 * ```
 */
const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(
  function CopyButton(
    { label = "Copy", copiedLabel = "Copied", copied, className, ...props },
    ref,
  ) {
    return (
      <OutlineButton
        ref={ref}
        type="button"
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-[color:var(--ui-border-strong)] bg-[color:var(--ui-bg)] px-2 py-1 text-ui-xs font-medium text-[color:var(--ui-ink-secondary)] transition hover:bg-[color:var(--ui-bg-soft)]",
          className,
        )}
        {...props}
      >
        <CopyIcon size="h-3.5 w-3.5" />
        {copied ? copiedLabel : label}
      </OutlineButton>
    );
  },
);

CopyButton.displayName = "CopyButton";

export default CopyButton;
