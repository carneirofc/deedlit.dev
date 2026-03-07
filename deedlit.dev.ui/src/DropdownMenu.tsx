"use client";

import { forwardRef, type ReactNode, useState, useCallback } from "react";

import { cn } from "./utils";

export type DropdownMenuItem = {
  key: string;
  label: ReactNode;
  /** Optional leading indicator (e.g. colour swatch) */
  indicator?: ReactNode;
  /** Optional trailing element (e.g. check icon) */
  trailing?: ReactNode;
  onClick: () => void;
};

export type DropdownMenuProps = {
  /** The trigger element – rendered as-is, receives onClick handler */
  trigger: ReactNode;
  /** Whether the dropdown is controlled externally */
  open?: boolean;
  /** Called when open state changes (controlled mode) */
  onOpenChange?: (open: boolean) => void;
  /** Menu items */
  items: DropdownMenuItem[];
  /** Alignment of the dropdown panel relative to trigger */
  align?: "left" | "right";
  /** Minimum width for the dropdown panel */
  minWidth?: string;
  /** Additional className for the dropdown panel */
  panelClassName?: string;
  className?: string;
  testId?: string;
};

/**
 * A lightweight dropdown menu with backdrop-close behaviour.
 *
 * Can be used in controlled mode (open + onOpenChange) or
 * uncontrolled mode (manages its own state).
 */
const DropdownMenu = forwardRef<HTMLDivElement, DropdownMenuProps>(function DropdownMenu({
  trigger,
  open: controlledOpen,
  onOpenChange,
  items,
  align = "right",
  minWidth = "min-w-40",
  panelClassName,
  className,
  testId,
}, ref) {
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (isControlled) {
        onOpenChange?.(next);
      } else {
        setInternalOpen(next);
      }
    },
    [isControlled, onOpenChange],
  );

  const handleToggle = useCallback(() => {
    setOpen(!isOpen);
  }, [isOpen, setOpen]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  return (
    <div ref={ref} className={cn("relative", className)} data-testid={testId}>
      {/* Trigger – wraps trigger content with click handler */}
      <div onClick={handleToggle} role="button" tabIndex={-1}>
        {trigger}
      </div>

      {isOpen && (
        <>
          {/* Invisible backdrop to catch outside clicks */}
          <button
            type="button"
            className="fixed inset-0 z-40"
            onClick={handleClose}
            aria-label="Close menu"
          />
          {/* Dropdown panel */}
          <div
            className={cn(
              "absolute top-full z-50 mt-1 overflow-hidden rounded-xl border border-ui-border bg-ui-bg-card py-1 shadow-lg",
              align === "right" ? "right-0" : "left-0",
              minWidth,
              panelClassName,
            )}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  item.onClick();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui-xs transition hover:bg-ui-bg-soft"
              >
                {item.indicator}
                <span className="min-w-0 flex-1 truncate text-ui-ink-title">
                  {item.label}
                </span>
                {item.trailing}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
});

DropdownMenu.displayName = "DropdownMenu";

export default DropdownMenu;
