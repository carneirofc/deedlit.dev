"use client";

import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import { Tabs as RadixTabs } from "radix-ui";

import { cn } from "./utils";

/**
 * Accessible tabs built on Radix `Tabs`. Triggers expose `role="tab"` with
 * roving focus and arrow-key navigation; each `TabsContent` is linked to its
 * trigger via `aria-controls`/`aria-labelledby`.
 *
 * ```tsx
 * <Tabs defaultValue="details">
 *   <TabsList>
 *     <TabsTrigger value="details">Details</TabsTrigger>
 *     <TabsTrigger value="raw">Raw</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="details">…</TabsContent>
 *   <TabsContent value="raw">…</TabsContent>
 * </Tabs>
 * ```
 */
export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<
  ElementRef<typeof RadixTabs.List>,
  ComponentPropsWithoutRef<typeof RadixTabs.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <RadixTabs.List
      ref={ref}
      className={cn(
        "inline-flex gap-1 rounded-lg border border-(--ui-border-soft) bg-panel/90 p-0.5",
        className,
      )}
      {...props}
    />
  );
});
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
  ElementRef<typeof RadixTabs.Trigger>,
  ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <RadixTabs.Trigger
      ref={ref}
      className={cn(
        "cursor-pointer rounded-md border border-transparent bg-transparent px-2 py-0.5 text-ui-2xs text-[color:var(--ui-ink-secondary)] outline-none transition-colors",
        "hover:bg-[color:var(--ui-bg-soft)]",
        "focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_45%,transparent)]",
        "data-[state=active]:border-ui-active data-[state=active]:bg-[color:var(--ui-bg-active)] data-[state=active]:text-[color:var(--ui-ink-highlight)]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<
  ElementRef<typeof RadixTabs.Content>,
  ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <RadixTabs.Content
      ref={ref}
      className={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_45%,transparent)]",
        className,
      )}
      {...props}
    />
  );
});
TabsContent.displayName = "TabsContent";
