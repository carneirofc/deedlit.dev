"use client";

import { forwardRef, type ForwardedRef, type ReactElement, type ReactNode } from "react";

import OutlineButton from "./OutlineButton";
import { cn } from "./utils";

export type SegmentedControlOption<TValue extends string = string> = {
  value: TValue;
  label: ReactNode;
  testId?: string;
  disabled?: boolean;
  tooltip?: string;
  ariaLabel?: string;
  title?: string;
  className?: string;
};

export type SegmentedControlProps<TValue extends string = string> = {
  value: TValue;
  options: Array<SegmentedControlOption<TValue>>;
  onValueChange: (value: TValue) => void;
  className?: string;
  optionClassName?: string;
  activeOptionClassName?: string;
  inactiveOptionClassName?: string;
};

const DEFAULT_ACTIVE_OPTION_CLASS =
  "border-ui-active bg-[color:var(--ui-bg-active)] text-[color:var(--ui-ink-highlight)]";

const DEFAULT_INACTIVE_OPTION_CLASS =
  "border-transparent bg-transparent text-[color:var(--ui-ink-secondary)] hover:bg-[color:var(--ui-bg-soft)]";

function SegmentedControlFn<TValue extends string = string>(
  {
    value,
    options,
    onValueChange,
    className,
    optionClassName,
    activeOptionClassName = DEFAULT_ACTIVE_OPTION_CLASS,
    inactiveOptionClassName = DEFAULT_INACTIVE_OPTION_CLASS,
  }: SegmentedControlProps<TValue>,
  ref: ForwardedRef<HTMLDivElement>,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "inline-flex gap-1 rounded-lg border border-(--ui-border-soft) bg-panel/90 p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        const inferredOptionLabel = typeof option.label === "string" ? option.label : undefined;
        const optionTooltip = option.tooltip ?? option.title ?? inferredOptionLabel;
        const optionAriaLabel = option.ariaLabel ?? inferredOptionLabel ?? optionTooltip;

        return (
          <OutlineButton
            key={option.value}
            data-testid={option.testId}
            tooltip={optionTooltip}
            aria-label={optionAriaLabel}
            disabled={option.disabled}
            onClick={() => onValueChange(option.value)}
            aria-pressed={isActive}
            className={cn(
              "rounded-md px-2 py-0.5 text-ui-2xs",
              optionClassName,
              isActive ? activeOptionClassName : inactiveOptionClassName,
              option.className,
            )}
          >
            {option.label}
          </OutlineButton>
        );
      })}
    </div>
  );
}

const SegmentedControl = forwardRef(SegmentedControlFn) as <TValue extends string = string>(
  props: SegmentedControlProps<TValue> & { ref?: ForwardedRef<HTMLDivElement> },
) => ReactElement;

(SegmentedControl as { displayName?: string }).displayName = "SegmentedControl";

export default SegmentedControl;