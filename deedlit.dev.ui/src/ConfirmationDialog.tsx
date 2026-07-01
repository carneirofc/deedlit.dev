"use client";

import { forwardRef } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "./Dialog";
import OutlineButton from "./OutlineButton";
import { cn, SPACING_PATTERNS, BORDER_PATTERNS } from "./utils";

export type ConfirmationDialogData = {
  title: string;
  details: string[];
  outcomes: string[];
  confirmLabel?: string;
  cancelLabel?: string;
};

export type ConfirmationDialogProps = {
  dialog: ConfirmationDialogData;
  onClose: (accepted: boolean) => void;
  className?: string;
  overlayClassName?: string;
  testIdPrefix?: string;
};

/**
 * Confirmation dialog driven by a `dialog` data object. Built on the accessible
 * {@link Dialog} primitives, so it traps focus, restores focus on close, makes
 * the background inert, and dismisses on `Escape`/backdrop — invoking
 * `onClose(false)`. Mount it only while a confirmation is pending.
 */
const ConfirmationDialog = forwardRef<HTMLDivElement, ConfirmationDialogProps>(function ConfirmationDialog({
  dialog,
  onClose,
  className,
  overlayClassName,
  testIdPrefix = "confirmation-dialog",
}, ref) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose(false);
      }}
    >
      <DialogContent
        ref={ref}
        id={testIdPrefix}
        data-testid={testIdPrefix}
        size="lg"
        showCloseButton={false}
        overlayClassName={cn("ui-anim-overlay z-120 bg-ui-overlay-soft", overlayClassName)}
        aria-describedby={undefined}
        className={cn("max-w-180", className)}
      >
        <div className={cn(BORDER_PATTERNS.bottomFaint, SPACING_PATTERNS.dialogSection)}>
          <p className="text-ui-sm font-semibold uppercase tracking-[0.08em] text-ui-ink-subtle">
            Confirm Action
          </p>
          <DialogTitle className="mt-1 text-ui-lg">{dialog.title}</DialogTitle>
        </div>

        <div className={cn("max-h-[min(62dvh,36rem)] space-y-4 overflow-y-auto text-ui-sm text-ui-ink-accent", SPACING_PATTERNS.dialogSection)}>
          <section>
            <p className="ui-text-label-sm text-ui-ink-subtle">Details</p>
            <ul className="mt-2 space-y-1">
              {dialog.details.map((line, index) => (
                <li key={`detail:${index}`} className={cn("rounded-md bg-ui-bg-muted", SPACING_PATTERNS.controlXs)}>
                  {line}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <p className="ui-text-label-sm text-ui-ink-subtle">If You Accept</p>
            <ul className="mt-2 space-y-1">
              {dialog.outcomes.map((line, index) => (
                <li key={`outcome:${index}`} className={cn("rounded-md bg-ui-bg-info", SPACING_PATTERNS.controlXs)}>
                  {line}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className={cn("flex items-center justify-end gap-2", BORDER_PATTERNS.topFaint, SPACING_PATTERNS.dialogSection)}>
          <DialogClose asChild>
            <OutlineButton data-testid={`${testIdPrefix}-cancel-button`} controlSize="md">
              {dialog.cancelLabel ?? "Cancel"}
            </OutlineButton>
          </DialogClose>
          <OutlineButton
            autoFocus
            data-testid={`${testIdPrefix}-accept-button`}
            onClick={() => onClose(true)}
            variant="accent"
            controlSize="md"
          >
            {dialog.confirmLabel ?? "Confirm"}
          </OutlineButton>
        </div>
      </DialogContent>
    </Dialog>
  );
});

ConfirmationDialog.displayName = "ConfirmationDialog";

export default ConfirmationDialog;
