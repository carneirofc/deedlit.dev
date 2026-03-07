"use client";

import { type ReactNode, useEffect } from "react";
import { OutlineButton, SegmentedControl, XIcon, ChevronLeftIcon } from "@deedlit.dev/ui";

export type UnifiedDockTab = "controls" | "filters" | "collections";

type GalleryUnifiedDockProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: UnifiedDockTab;
  onActiveTabChange: (tab: UnifiedDockTab) => void;
  badgeCount: number;
  children: ReactNode;
};

export default function GalleryUnifiedDock({
  isOpen,
  onOpenChange,
  activeTab,
  onActiveTabChange,
  badgeCount,
  children,
}: GalleryUnifiedDockProps) {
  useEffect(() => {
    if (!isOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onOpenChange]);

  return (
    <>
      {/* Backdrop - only visible when open */}
      {isOpen && (
        <div
          onClick={() => onOpenChange(false)}
          className="fixed inset-0 z-40 bg-slate-950/30 transition-opacity md:hidden"
          aria-hidden="true"
        />
      )}

      {/* Horizontal accordion panel from right side */}
      <aside
        className={`fixed right-0 top-0 bottom-0 z-100 flex w-[85vw] max-w-sm flex-col border-l border-ui-border bg-ui-bg shadow-2xl transition-transform duration-300 ease-in-out md:hidden ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header with close button */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ui-border p-3">
          <p className="text-ui-xs uppercase tracking-[0.14em] text-ui-ink-caption">
            Gallery Dock
          </p>
          <OutlineButton
            onClick={() => onOpenChange(false)}
            className="rounded-md px-2 py-1 text-ui-xs"
            aria-label="Close"
          >
            <XIcon size="h-4 w-4" />
          </OutlineButton>
        </div>

        {/* Tab switcher */}
        <div className="shrink-0 border-b border-ui-border p-3">
          <SegmentedControl
            value={activeTab}
            onValueChange={onActiveTabChange}
            className="grid w-full grid-cols-3 rounded-xl border border-ui-border-soft bg-panel/70 p-1"
            optionClassName="rounded-lg px-2 py-1.5 text-ui-xs"
            options={[
              { value: "controls", label: "Controls" },
              { value: "filters", label: "Filters" },
              { value: "collections", label: "Collections" },
            ]}
          />
        </div>

        {/* Content - scrollable */}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
          {children}
        </div>
      </aside>

      {/* Tab handle - visible when closed */}
      {!isOpen && (
        <button
          onClick={() => onOpenChange(true)}
          aria-label="Open dock"
          className="fixed right-0 top-1/2 z-50 flex -translate-y-1/2 items-center gap-1.5 rounded-l-lg border border-r-0 border-ui-border bg-ui-bg px-1.5 py-3 text-ui-2xs text-ui-ink-muted shadow-lg transition-all hover:px-2 hover:text-ui-ink-title md:hidden"
        >
          <ChevronLeftIcon size="h-4 w-4" />
          {badgeCount > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-(--ui-accent) text-[10px] font-semibold text-white">
              {badgeCount > 9 ? "9+" : badgeCount}
            </span>
          )}
        </button>
      )}
    </>
  );
}

