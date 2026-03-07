"use client";

import { type ReactNode } from "react";
import { DockPanel, SegmentedControl } from "@deedlit.dev/ui";

export type GalleryFiltersTab = "tag-filter-panel" | "path-tree-filter" | "tag-preset-panel";

type GalleryFiltersDockProps = {
  isOpen: boolean;
  activeFilterCount: number;
  activeTab: GalleryFiltersTab;
  onOpenChange: (open: boolean) => void;
  onActiveTabChange: (tab: GalleryFiltersTab) => void;
  children: ReactNode;
};

export default function GalleryFiltersDock({
  isOpen,
  activeFilterCount,
  activeTab,
  onOpenChange,
  onActiveTabChange,
  children,
}: GalleryFiltersDockProps) {
  return (
    <DockPanel
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Filter Dock"
      badgeCount={activeFilterCount}
      openLabel="Open filters"
      closeLabel="Close filters"
      testIdPrefix="gallery-filters-dock"
      size="xl"
      toggleSlot={0}
      stackOrder={0}
      panelClassName="md:min-h-[40rem] md:resize"
      headerExtras={
        <div className="mt-2">
          <SegmentedControl
            value={activeTab}
            onValueChange={onActiveTabChange}
            className="grid w-full grid-cols-3 rounded-xl border border-(--ui-border-soft) bg-panel/70 p-1"
            optionClassName="rounded-lg px-2 py-1 text-ui-xs"
            options={[
              {
                value: "tag-filter-panel",
                label: "Tags",
                testId: "gallery-filters-dock-tag-tab",
              },
              {
                value: "path-tree-filter",
                label: "Path Tree",
                testId: "gallery-filters-dock-path-tab",
              },
              {
                value: "tag-preset-panel",
                label: "Presets",
                testId: "gallery-filters-dock-presets-tab",
              },
            ]}
          />
        </div>
      }
    >
      {children}
    </DockPanel>
  );
}

