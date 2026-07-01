"use client";

import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import { DropdownMenu as RadixDropdownMenu } from "radix-ui";

import { cn } from "./utils";

/**
 * Accessible dropdown menu built on Radix `DropdownMenu`. The trigger gains
 * `aria-haspopup`/`aria-expanded`, the panel supports full keyboard navigation
 * (arrow keys, Home/End, typeahead) with roving focus, and dismissal on outside
 * click / `Escape` is handled for you.
 *
 * ```tsx
 * <DropdownMenu>
 *   <DropdownMenuTrigger asChild><OutlineButton>Sort</OutlineButton></DropdownMenuTrigger>
 *   <DropdownMenuContent align="end">
 *     <DropdownMenuItem onSelect={() => …}>Newest</DropdownMenuItem>
 *     <DropdownMenuSeparator />
 *     <DropdownMenuItem onSelect={() => …}>Oldest</DropdownMenuItem>
 *   </DropdownMenuContent>
 * </DropdownMenu>
 * ```
 */
export const DropdownMenu = RadixDropdownMenu.Root;
export const DropdownMenuTrigger = RadixDropdownMenu.Trigger;
export const DropdownMenuGroup = RadixDropdownMenu.Group;
export const DropdownMenuRadioGroup = RadixDropdownMenu.RadioGroup;
export const DropdownMenuSub = RadixDropdownMenu.Sub;
export const DropdownMenuSubTrigger = RadixDropdownMenu.SubTrigger;

const ITEM_CLASS_NAME =
  "flex w-full cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-left text-ui-xs text-ui-ink-title outline-none transition-colors data-[highlighted]:bg-ui-bg-soft data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof RadixDropdownMenu.Content>,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.Content>
>(function DropdownMenuContent({ className, sideOffset = 4, ...props }, ref) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "ui-anim-popover z-130 min-w-40 overflow-hidden rounded-xl border border-ui-border bg-ui-bg-card py-1 shadow-lg",
          className,
        )}
        {...props}
      />
    </RadixDropdownMenu.Portal>
  );
});
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof RadixDropdownMenu.Item>,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.Item>
>(function DropdownMenuItem({ className, ...props }, ref) {
  return <RadixDropdownMenu.Item ref={ref} className={cn(ITEM_CLASS_NAME, className)} {...props} />;
});
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof RadixDropdownMenu.CheckboxItem>,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, ...props }, ref) {
  return (
    <RadixDropdownMenu.CheckboxItem ref={ref} className={cn(ITEM_CLASS_NAME, className)} {...props} />
  );
});
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export const DropdownMenuRadioItem = forwardRef<
  ElementRef<typeof RadixDropdownMenu.RadioItem>,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.RadioItem>
>(function DropdownMenuRadioItem({ className, ...props }, ref) {
  return <RadixDropdownMenu.RadioItem ref={ref} className={cn(ITEM_CLASS_NAME, className)} {...props} />;
});
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

export const DropdownMenuLabel = forwardRef<
  ElementRef<typeof RadixDropdownMenu.Label>,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.Label>
>(function DropdownMenuLabel({ className, ...props }, ref) {
  return (
    <RadixDropdownMenu.Label
      ref={ref}
      className={cn(
        "px-3 py-1.5 text-ui-2xs font-semibold uppercase tracking-[0.08em] text-ui-ink-subtle",
        className,
      )}
      {...props}
    />
  );
});
DropdownMenuLabel.displayName = "DropdownMenuLabel";

export const DropdownMenuSeparator = forwardRef<
  ElementRef<typeof RadixDropdownMenu.Separator>,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <RadixDropdownMenu.Separator
      ref={ref}
      className={cn("my-1 h-px bg-ui-faint", className)}
      {...props}
    />
  );
});
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
