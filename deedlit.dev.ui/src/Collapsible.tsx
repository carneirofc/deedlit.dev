"use client";

import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import { Collapsible as RadixCollapsible } from "radix-ui";

import { cn } from "./utils";

/**
 * Accessible disclosure built on Radix `Collapsible`. The trigger is linked to
 * the content via `aria-controls`/`aria-expanded`, and the content animates its
 * height using the `--radix-collapsible-content-height` CSS variable.
 */
export const Collapsible = RadixCollapsible.Root;
export const CollapsibleTrigger = RadixCollapsible.Trigger;

export const CollapsibleContent = forwardRef<
  ElementRef<typeof RadixCollapsible.Content>,
  ComponentPropsWithoutRef<typeof RadixCollapsible.Content>
>(function CollapsibleContent({ className, ...props }, ref) {
  return (
    <RadixCollapsible.Content
      ref={ref}
      className={cn("ui-anim-collapsible", className)}
      {...props}
    />
  );
});
CollapsibleContent.displayName = "CollapsibleContent";
