"use client";

import {
  forwardRef,
  type ForwardedRef,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";

import { cn, SPACING_PATTERNS, BORDER_PATTERNS } from "./utils";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  onOpen?: () => void;
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  testId?: string;
  size?: ModalSize;
  className?: string;
  overlayClassName?: string;
  contentClassName?: string;
  closeLabel?: string;
  showCloseButton?: boolean;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
};

const SIZE_CLASS_NAMES: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  full: "max-w-[96vw]",
};

function assignForwardedRef<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    (ref as { current: T | null }).current = value;
  }
}

const Modal = forwardRef<HTMLDivElement, ModalProps>(function Modal({
  open,
  onClose,
  onOpen,
  children,
  title,
  description,
  footer,
  testId,
  size = "md",
  className,
  overlayClassName,
  contentClassName,
  closeLabel = "Close dialog",
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
}, ref) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const setPanelRef = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      assignForwardedRef(ref, node);
    },
    [ref],
  );

  useEffect(() => {
    if (!open || !closeOnEscape) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, closeOnEscape, onClose]);

  useEffect(() => {
    if (!open) return;
    if (onOpen) onOpen();

    const htmlNode = document.documentElement;
    const scrollbarWidth = Math.max(0, window.innerWidth - htmlNode.clientWidth);
    const previousOverflow = document.body.style.overflow;
    const previousOffset = htmlNode.style.getPropertyValue("--scroll-lock-offset");
    htmlNode.style.setProperty("--scroll-lock-offset", `${scrollbarWidth}px`);
    document.body.style.overflow = "hidden";

    return () => {
      if (previousOffset) {
        htmlNode.style.setProperty("--scroll-lock-offset", previousOffset);
      } else {
        htmlNode.style.removeProperty("--scroll-lock-offset");
      }
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const frameId = window.requestAnimationFrame(() => {
      const panelNode = panelRef.current;
      if (!panelNode) return;

      const explicitPrimaryAction = panelNode.querySelector<HTMLElement>(
        "[data-modal-primary-action='true']:not([disabled])",
      );
      const explicitAutofocus = panelNode.querySelector<HTMLElement>("[autofocus]:not([disabled])");
      const footerButtons = Array.from(
        panelNode.querySelectorAll<HTMLButtonElement>("[data-modal-footer] button:not([disabled])"),
      );
      const bodyButtons = Array.from(panelNode.querySelectorAll<HTMLButtonElement>("button:not([disabled])")).filter(
        (button) => !button.closest("[data-modal-header]"),
      );

      const focusTarget =
        explicitPrimaryAction ?? explicitAutofocus ?? footerButtons.at(-1) ?? bodyButtons.at(-1) ?? null;

      focusTarget?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (!closeOnBackdropClick) return;
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return createPortal(
    <div
      id={testId}
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        "fixed inset-0 z-130 flex items-center justify-center bg-ui-overlay-strong p-4",
        overlayClassName,
      )}
      onClick={handleOverlayClick}
    >
      <div
        ref={setPanelRef}
        className={cn(
          "flex max-h-full w-full flex-col overflow-hidden rounded-2xl border-ui-modal bg-ui-bg-card shadow-ui-strong",
          SIZE_CLASS_NAMES[size],
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {title || description || showCloseButton ? (
          <div
            data-modal-header="true"
            className={cn("flex items-start justify-between gap-3", BORDER_PATTERNS.bottomFaint, SPACING_PATTERNS.dialogSectionResponsive)}
          >
            <div>
              {title ? (
                <h2 id={titleId} className="text-ui-lg font-semibold text-ui-ink-strong">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={descriptionId} className="mt-1 text-ui-sm text-ui-ink-subtle">
                  {description}
                </p>
              ) : null}
            </div>
            {showCloseButton ? (
              <button
                type="button"
                aria-label={closeLabel}
                title={closeLabel}
                onClick={onClose}
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-ui-soft text-ui-ink-subtle transition hover:bg-ui-bg-soft hover:text-ui-ink-strong active:scale-95"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
                <span className="sr-only">{closeLabel}</span>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={cn("min-h-0 flex-1 overflow-auto p-4 sm:p-5", contentClassName)}>{children}</div>

        {footer ? (
          <div data-modal-footer="true" className={cn(BORDER_PATTERNS.topFaint, SPACING_PATTERNS.dialogSectionResponsive)}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
});

Modal.displayName = "Modal";

export default Modal;
