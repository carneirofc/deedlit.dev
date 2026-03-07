"use client";

import { forwardRef } from "react";
import { createPortal } from "react-dom";

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

const ConfirmationDialog = forwardRef<HTMLDivElement, ConfirmationDialogProps>(function ConfirmationDialog({
  dialog,
  onClose,
  className,
  overlayClassName,
  testIdPrefix = "confirmation-dialog",
}, ref) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      id={`${testIdPrefix}-overlay`}
      data-testid={`${testIdPrefix}-overlay`}
      className={cn(
        "fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-[color:var(--ui-overlay-soft)] p-4",
        overlayClassName,
      )}
      role="dialog"
      aria-modal="true"
      aria-label={dialog.title}
      onClick={() => onClose(false)}
    >
      <div
        ref={ref}
        id={testIdPrefix}
        data-testid={testIdPrefix}
        className={cn(
          "w-full max-w-[720px] overflow-hidden rounded-2xl border-ui-modal bg-[color:var(--ui-bg-card)] shadow-[var(--ui-shadow-strong)]",
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={cn(BORDER_PATTERNS.bottomFaint, SPACING_PATTERNS.dialogSection)}>
          <p className="text-ui-sm font-semibold uppercase tracking-[0.08em] text-[color:var(--ui-ink-subtle)]">
            Confirm Action
          </p>
          <h3 className="mt-1 text-ui-lg font-semibold text-[color:var(--ui-ink-strong)]">
            {dialog.title}
          </h3>
        </div>

        <div className={cn("max-h-[min(62dvh,36rem)] space-y-4 overflow-y-auto text-ui-sm text-[color:var(--ui-ink-accent)]", SPACING_PATTERNS.dialogSection)}>
          <section>
            <p className="ui-text-label-sm text-[color:var(--ui-ink-subtle)]">Details</p>
            <ul className="mt-2 space-y-1">
              {dialog.details.map((line, index) => (
                <li key={`detail:${index}`} className={cn("rounded-md bg-[color:var(--ui-bg-muted)]", SPACING_PATTERNS.controlXs)}>
                  {line}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <p className="ui-text-label-sm text-[color:var(--ui-ink-subtle)]">If You Accept</p>
            <ul className="mt-2 space-y-1">
              {dialog.outcomes.map((line, index) => (
                <li key={`outcome:${index}`} className={cn("rounded-md bg-[color:var(--ui-bg-info)]", SPACING_PATTERNS.controlXs)}>
                  {line}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className={cn("flex items-center justify-end gap-2", BORDER_PATTERNS.topFaint, SPACING_PATTERNS.dialogSection)}>
          <OutlineButton
            data-testid={`${testIdPrefix}-cancel-button`}
            onClick={() => onClose(false)}
            controlSize="md"
          >
            {dialog.cancelLabel ?? "Cancel"}
          </OutlineButton>
          <OutlineButton
            data-testid={`${testIdPrefix}-accept-button`}
            onClick={() => onClose(true)}
            variant="accent"
            controlSize="md"
          >
            {dialog.confirmLabel ?? "Confirm"}
          </OutlineButton>
        </div>
      </div>
    </div>,
    document.body,
  );
});

ConfirmationDialog.displayName = "ConfirmationDialog";

export default ConfirmationDialog;
