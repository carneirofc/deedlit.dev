"use client";

import { forwardRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "./utils";

export type ToastTone = "info" | "success" | "warn" | "error";
export type ToastRole = "status" | "alert";

export type ToastProps = {
  open?: boolean;
  testId?: string;
  tone?: ToastTone;
  role?: ToastRole;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
  contentClassName?: string;
};

const TONE_CLASS_NAMES: Record<ToastTone, string> = {
  info: "border-ui-strong text-[color:var(--ui-ink-accent)]",
  success: "border-success-edge bg-success text-success-ink",
  warn: "border-warn-edge bg-warn text-warn-ink",
  error: "border-error-edge bg-error text-error-ink",
};

const Toast = forwardRef<HTMLDivElement, ToastProps>(function Toast(
  {
    open = true,
    testId,
    tone = "info",
    role,
    title,
    description,
    action,
    onClose,
    closeLabel = "Dismiss toast",
    className,
    contentClassName,
  },
  ref,
) {
  if (!open) return null;
  if (typeof document === "undefined") return null;

  const resolvedRole = role ?? (tone === "error" || tone === "warn" ? "alert" : "status");

  return createPortal(
    <div
      className={cn(
        "fixed bottom-2 left-2 z-[95] w-[calc(100%-1rem)] max-w-sm px-0 sm:bottom-4 sm:left-4 sm:w-full md:bottom-6 md:left-6",
        className,
      )}
    >
      <div
        ref={ref}
        id={testId}
        data-testid={testId}
        role={resolvedRole}
        aria-live={resolvedRole === "alert" ? "assertive" : "polite"}
        className={cn(
          "relative rounded-xl border bg-[color:var(--ui-bg-card)] p-3 shadow-[var(--ui-shadow-strong)]",
          TONE_CLASS_NAMES[tone],
          contentClassName,
        )}
      >
        {onClose ? (
          <button
            type="button"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onClose}
            data-testid={testId ? `${testId}-dismiss` : undefined}
            className="absolute top-2 right-2 inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-[color:var(--ui-ink-subtle)] transition hover:bg-[color:var(--ui-bg-soft)] hover:text-[color:var(--ui-ink-strong)] active:scale-95"
          >
            <span aria-hidden="true" className="text-ui-sm leading-none">
              x
            </span>
            <span className="sr-only">{closeLabel}</span>
          </button>
        ) : null}

        <div className={cn(onClose ? "pr-7" : undefined)}>
          <p className="text-ui-sm font-semibold">{title}</p>
          {description ? <p className="mt-1 text-ui-xs opacity-90">{description}</p> : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
});

Toast.displayName = "Toast";

export default Toast;

