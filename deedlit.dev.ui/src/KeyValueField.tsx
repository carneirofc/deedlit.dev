"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "./utils";

export type KeyValueFieldProps = HTMLAttributes<HTMLDivElement> & {
  /** Small uppercase label. */
  label: ReactNode;
  /** Primary value content. */
  value: ReactNode;
  labelClassName?: string;
  valueClassName?: string;
};

/**
 * A small card displaying a label/value pair on a soft background.
 *
 * ```tsx
 * <KeyValueField label="Model" value="SD 1.5" />
 * ```
 */
const KeyValueField = forwardRef<HTMLDivElement, KeyValueFieldProps>(
  function KeyValueField({ label, value, className, labelClassName, valueClassName, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("rounded-lg bg-[color:var(--ui-bg-soft)] px-2 py-2", className)}
        {...props}
      >
        <p className={cn("text-ui-xs uppercase tracking-wide text-[color:var(--ui-ink-subtle)]", labelClassName)}>
          {label}
        </p>
        <p className={cn("mt-1 break-words text-ui-sm text-[color:var(--ui-ink-primary)]", valueClassName)}>
          {value}
        </p>
      </div>
    );
  },
);

KeyValueField.displayName = "KeyValueField";

export default KeyValueField;
