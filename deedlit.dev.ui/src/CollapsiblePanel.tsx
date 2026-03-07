"use client";

import type { ReactNode } from "react";

import { ChevronDownIcon } from "./Icons";
import { useControllableState } from "./lib/use-controllable-state";
import { cn } from "./utils";

export type CollapsiblePanelProps = {
  label: ReactNode;
  isOpen?: boolean;
  onToggle?: () => void;
  defaultOpen?: boolean;
  children?: ReactNode;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  chevronClassName?: string;
};

export default function CollapsiblePanel({
  label,
  isOpen: isOpenProp,
  onToggle,
  defaultOpen = false,
  children,
  className,
  triggerClassName,
  contentClassName,
  chevronClassName,
}: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useControllableState({
    value: isOpenProp,
    defaultValue: defaultOpen,
    onChange: onToggle ? () => onToggle() : undefined,
  });

  const handleToggle = () => setIsOpen((prev) => !prev);

  return (
    <div className={cn(className)}>
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          "flex w-full items-center justify-between px-4 py-2.5 text-ui-sm font-medium text-ui-ink-secondary transition hover:bg-ui-bg-soft",
          triggerClassName,
        )}
        aria-expanded={isOpen}
      >
        <span>{label}</span>
        <ChevronDownIcon
          size="h-4 w-4"
          className={cn("transition-transform", isOpen ? "rotate-180" : "", chevronClassName)}
        />
      </button>

      {isOpen && <div className={contentClassName}>{children}</div>}
    </div>
  );
}
