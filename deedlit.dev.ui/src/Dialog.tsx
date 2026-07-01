"use client";

import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from "react";
import { Dialog as RadixDialog } from "radix-ui";

import { cn, SPACING_PATTERNS, BORDER_PATTERNS } from "./utils";

export type DialogSize = "sm" | "md" | "lg" | "xl" | "full";

const SIZE_CLASS_NAMES: Record<DialogSize, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  full: "max-w-[96vw]",
};

/**
 * Accessible dialog built on Radix `Dialog`. Provides a focus trap, focus
 * restoration on close, an inert background, scroll-lock, and `Escape` /
 * backdrop dismissal out of the box.
 *
 * Compose with the exported parts:
 *
 * ```tsx
 * <Dialog>
 *   <DialogTrigger asChild><OutlineButton>Open</OutlineButton></DialogTrigger>
 *   <DialogContent size="md">
 *     <DialogHeader>
 *       <DialogTitle>Title</DialogTitle>
 *       <DialogDescription>Optional description</DialogDescription>
 *     </DialogHeader>
 *     <div>…body…</div>
 *     <DialogFooter>
 *       <DialogClose asChild><OutlineButton>Cancel</OutlineButton></DialogClose>
 *     </DialogFooter>
 *   </DialogContent>
 * </Dialog>
 * ```
 */
export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;
export const DialogPortal = RadixDialog.Portal;

export const DialogOverlay = forwardRef<
  ElementRef<typeof RadixDialog.Overlay>,
  ComponentPropsWithoutRef<typeof RadixDialog.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <RadixDialog.Overlay
      ref={ref}
      className={cn(
        "ui-anim-overlay fixed inset-0 z-130 bg-ui-overlay-strong",
        className,
      )}
      {...props}
    />
  );
});
DialogOverlay.displayName = "DialogOverlay";

export type DialogContentProps = ComponentPropsWithoutRef<typeof RadixDialog.Content> & {
  size?: DialogSize;
  /** Hide the built-in close button rendered in the top-right corner. */
  showCloseButton?: boolean;
  closeLabel?: string;
  overlayClassName?: string;
  /** Render without the portal (e.g. inside an already-portaled host). */
  portal?: boolean;
};

export const DialogContent = forwardRef<
  ElementRef<typeof RadixDialog.Content>,
  DialogContentProps
>(function DialogContent(
  {
    className,
    children,
    size = "md",
    showCloseButton = true,
    closeLabel = "Close dialog",
    overlayClassName,
    portal = true,
    ...props
  },
  ref,
) {
  const body = (
    <>
      <DialogOverlay className={overlayClassName} />
      <RadixDialog.Content
        ref={ref}
        className={cn(
          "ui-anim-dialog fixed left-1/2 top-1/2 z-130 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border-ui-modal bg-ui-bg-card shadow-ui-strong",
          SIZE_CLASS_NAMES[size],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <RadixDialog.Close
            aria-label={closeLabel}
            title={closeLabel}
            className="absolute right-3 top-3 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-ui-soft text-ui-ink-subtle transition hover:bg-ui-bg-soft hover:text-ui-ink-strong active:scale-95"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
            <span className="sr-only">{closeLabel}</span>
          </RadixDialog.Close>
        ) : null}
      </RadixDialog.Content>
    </>
  );

  if (!portal) return body;
  return <RadixDialog.Portal>{body}</RadixDialog.Portal>;
});
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-dialog-header="true"
      className={cn(
        "flex flex-col gap-1 pr-10",
        BORDER_PATTERNS.bottomFaint,
        SPACING_PATTERNS.dialogSectionResponsive,
        className,
      )}
      {...props}
    />
  );
}

export const DialogTitle = forwardRef<
  ElementRef<typeof RadixDialog.Title>,
  ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <RadixDialog.Title
      ref={ref}
      className={cn("text-ui-lg font-semibold text-ui-ink-strong", className)}
      {...props}
    />
  );
});
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = forwardRef<
  ElementRef<typeof RadixDialog.Description>,
  ComponentPropsWithoutRef<typeof RadixDialog.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <RadixDialog.Description
      ref={ref}
      className={cn("text-ui-sm text-ui-ink-subtle", className)}
      {...props}
    />
  );
});
DialogDescription.displayName = "DialogDescription";

export function DialogBody({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-auto p-4 sm:p-5", className)} {...props} />;
}

export function DialogFooter({ className, children, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-dialog-footer="true"
      className={cn(
        "flex items-center justify-end gap-2",
        BORDER_PATTERNS.topFaint,
        SPACING_PATTERNS.dialogSectionResponsive,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type { ReactNode };
