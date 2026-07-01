"use client";

import type { ReactNode } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./Collapsible";
import { ChevronDownIcon } from "./Icons";
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

/**
 * Convenience disclosure panel built on the {@link Collapsible} primitives.
 * Gains a real `aria-controls` link between trigger and content plus an
 * animated height transition, while keeping the simple `label`/`isOpen` API.
 */
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
  const isControlled = isOpenProp !== undefined;

  return (
    <Collapsible
      open={isControlled ? isOpenProp : undefined}
      defaultOpen={isControlled ? undefined : defaultOpen}
      onOpenChange={onToggle ? () => onToggle() : undefined}
      className={cn(className)}
    >
      <CollapsibleTrigger
        className={cn(
          "group/cp flex w-full items-center justify-between px-4 py-2.5 text-ui-sm font-medium text-ui-ink-secondary transition hover:bg-ui-bg-soft",
          triggerClassName,
        )}
      >
        <span>{label}</span>
        <ChevronDownIcon
          size="h-4 w-4"
          className={cn(
            "transition-transform duration-200 group-data-[state=open]/cp:rotate-180",
            chevronClassName,
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className={contentClassName}>{children}</CollapsibleContent>
    </Collapsible>
  );
}
