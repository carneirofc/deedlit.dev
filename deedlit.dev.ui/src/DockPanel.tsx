"use client";

import { forwardRef, type ReactNode, useEffect, useId, useMemo } from "react";

import InfoChip from "./InfoChip";
import OutlineButton from "./OutlineButton";
import { XIcon } from "./Icons";
import { cn, SPACING_PATTERNS, LAYOUT_PATTERNS } from "./utils";

/* ── Size presets for the desktop panel width ─────────────────────── */
const SIZE_CLASSES = {
  sm: "md:w-[min(36rem,calc(100vw-1.5rem))] md:min-w-[28rem]",
  md: "md:w-[min(42rem,calc(100vw-1.5rem))] md:min-w-[32rem]",
  lg: "md:w-[min(48rem,calc(100vw-1.5rem))] md:min-w-[32rem]",
  xl: "md:w-[min(64rem,calc(100vw-1.5rem))] md:min-w-[42rem]",
} as const;

export type DockPanelSize = keyof typeof SIZE_CLASSES;

/* ── Toggle slot presets (vertical position of toggle button) ──────
 *  Each slot stacks the toggle button higher from the bottom-right.
 *  Slot 0 = bottom, 1 = middle, 2 = top, etc.
 */
const TOGGLE_SLOT_BOTTOM_REM = [1, 5, 9, 13] as const;

export type DockPanelProps = {
  /** Controlled open state */
  isOpen: boolean;
  /** Called when the panel should open or close */
  onOpenChange: (open: boolean) => void;
  /** Title shown in the dock header */
  title: string;
  /** Badge count shown on the toggle button */
  badgeCount?: number;
  /** Label text for the toggle button when closed */
  openLabel?: string;
  /** Label text for the toggle button when open */
  closeLabel?: string;
  /** Panel content */
  children: ReactNode;
  /** Optional content inserted between the header and the scrollable children area */
  headerExtras?: ReactNode;

  /**
   * Desktop panel width preset. Defaults to "md".
   *   sm ≈ 36 rem, md ≈ 42 rem, lg ≈ 48 rem, xl ≈ 64 rem
   */
  size?: DockPanelSize;

  /**
   * Vertical slot index for the toggle button (0 = bottom, 1, 2, …).
   * Auto-positions the toggle at `right: 1rem; bottom: <slot-offset>`.
   * Use instead of `toggleClassName` for standard stacked-dock layouts.
   */
  toggleSlot?: number;

  /**
   * Stacking order when multiple DockPanels coexist.
   * Higher numbers render above lower ones.  Controls z-index of
   * the toggle button, backdrop overlay, and panel.  Defaults to 0.
   */
  stackOrder?: number;

  /** @deprecated Prefer `toggleSlot` + `stackOrder`. Raw className for the toggle button. */
  toggleClassName?: string;
  /** Extra className merged into the panel (use for additional overrides only) */
  panelClassName?: string;
  /** className for the scrollable content wrapper */
  contentClassName?: string;

  /** Prefix for all data-testid and id attributes */
  testIdPrefix?: string;
  /** Whether pressing Escape closes the panel (default: true) */
  closeOnEscape?: boolean;
};

const DockPanel = forwardRef<HTMLElement, DockPanelProps>(function DockPanel({
  isOpen,
  onOpenChange,
  title,
  badgeCount,
  openLabel,
  closeLabel,
  children,
  headerExtras,
  size = "md",
  toggleSlot,
  stackOrder = 0,
  toggleClassName,
  panelClassName,
  contentClassName,
  testIdPrefix,
  closeOnEscape = true,
}, ref) {
  const generatedId = useId();
  const baseId = testIdPrefix ?? `dock-panel-${generatedId}`;

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, closeOnEscape, onOpenChange]);

  /* ── Z-index layers derived from stackOrder ──────────────────────
   *  backdrop  = 40 + stackOrder   (40, 41, 42 …)
   *  toggle    = 50 + stackOrder   (50, 51, 52 …)
   *  panel     = 60 + stackOrder   (60, 61, 62 …)
   *
   *  All toggles (50+) sit above all backdrops (40+).
   *  All panels  (60+) sit above all toggles.
   *  Within each group, higher stackOrder wins.
   */
  const zBackdrop = 40 + stackOrder;
  const zToggle   = 50 + stackOrder;
  const zPanel    = 60 + stackOrder;

  /* ── Toggle position from slot or legacy className ───────────────
   *  When `toggleSlot` is provided, position is auto-calculated.
   *  Falls back to `toggleClassName` for custom overrides.
   */
  const toggleStyle = useMemo(() => {
    if (typeof toggleSlot !== "number") return { zIndex: zToggle };
    const bottomRem = TOGGLE_SLOT_BOTTOM_REM[toggleSlot] ?? (1 + toggleSlot * 4);
    return { zIndex: zToggle, right: "1rem", bottom: `${bottomRem}rem` };
  }, [toggleSlot, zToggle]);

  const resolvedOpenLabel = openLabel ?? `Open ${title.toLowerCase()}`;
  const resolvedCloseLabel = closeLabel ?? `Close ${title.toLowerCase()}`;

  /*
   * IMPORTANT: State-dependent classes (visibility, opacity, translate) are
   * concatenated directly — NOT passed through twMerge/cn().
   *
   * tailwind-merge v3 + Tailwind v4 incorrectly strips `invisible`, `opacity-0`,
   * and corrupts `transition-[transform,opacity,visibility]` when merging with
   * arbitrary consumer className strings.  Keeping them outside cn() guarantees
   * the open/close transition classes are never removed.
   */
  const panelStateClasses = isOpen
    ? "visible opacity-100 translate-y-0 md:translate-x-0"
    : "invisible opacity-0 pointer-events-none translate-y-full md:translate-y-0 md:translate-x-full";

  const asideClassName = [
    // Structure (z-index via inline style)
    "fixed overflow-hidden rounded-2xl border-ui bg-[color:var(--ui-bg)] shadow-2xl",
    // Transition
    "transition-all duration-200",
    // Default positioning: mobile bottom-sheet, desktop right-side panel
    "inset-x-2 bottom-4 max-h-[70vh] min-h-[22rem]",
    "md:inset-x-auto md:top-3 md:right-3 md:bottom-auto md:max-h-[calc(100vh-1.5rem)] md:min-h-[28rem] md:max-w-[92vw]",
    // Width from size preset
    SIZE_CLASSES[size],
    // Open / close state (never goes through twMerge)
    panelStateClasses,
    // Consumer overrides
    panelClassName,
  ].filter(Boolean).join(" ");

  return (
    <>
      {/* Toggle button */}
      <OutlineButton
        id={`${baseId}-toggle`}
        data-testid={`${baseId}-toggle`}
        onClick={() => onOpenChange(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={baseId}
        style={toggleStyle}
        className={cn(
          "fixed inline-flex min-h-11 items-center gap-2 rounded-full border-ui-active bg-[color:var(--ui-bg-active)] px-4 py-2 text-ui-sm text-[color:var(--ui-ink-highlight)] shadow-lg",
          toggleClassName,
        )}
      >
        <span>{isOpen ? resolvedCloseLabel : resolvedOpenLabel}</span>
        {typeof badgeCount === "number" ? (
          <InfoChip className="px-1.5 py-0.5 text-ui-xs">{badgeCount}</InfoChip>
        ) : null}
      </OutlineButton>

      {/* Backdrop overlay */}
      {isOpen && (
        <div
          role="presentation"
          onClick={() => onOpenChange(false)}
          style={{ zIndex: zBackdrop }}
          className="fixed inset-0 bg-slate-950/30 transition-opacity"
        />
      )}

      {/* Panel */}
      <aside
        ref={ref}
        id={baseId}
        data-testid={baseId}
        data-state={isOpen ? "open" : "closed"}
        style={{ zIndex: zPanel }}
        className={asideClassName}
      >
        <div className="flex h-full min-h-0 min-w-0 flex-col p-3">
          {/* Header with close button */}
          <div className={cn(LAYOUT_PATTERNS.flexCenterBetweenGap2)}>
            <p className="text-ui-xs uppercase tracking-[0.14em] text-[color:var(--ui-ink-caption)]">
              {title}
            </p>
            <OutlineButton
              onClick={() => onOpenChange(false)}
              className={cn("rounded-md text-ui-xs", SPACING_PATTERNS.controlXs)}
              aria-label="Close"
            >
              <XIcon size="h-4 w-4" />
            </OutlineButton>
          </div>

          {/* Optional header extras (e.g., tabs) */}
          {headerExtras}

          {/* Scrollable content */}
          <div
            className={cn(
              "mt-2 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-1",
              contentClassName,
            )}
          >
            {children}
          </div>
        </div>
      </aside>
    </>
  );
});

DockPanel.displayName = "DockPanel";

export default DockPanel;
