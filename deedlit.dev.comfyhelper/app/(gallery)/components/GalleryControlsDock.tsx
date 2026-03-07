"use client";

import { useEffect } from "react";
import { DockPanel, InfoChip, OutlineButton, SelectInput, TextInput } from "@deedlit.dev/ui";
import type { RootDirectory } from "@/lib/library-types";

type SortOrder = "newest" | "oldest" | "none";

type GalleryControlsDockProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  roots: RootDirectory[];
  imagesCount: number;
  totalImages: number;
  scannedAtLabel: string;
  selectedRootId: string;
  searchTerm: string;
  onRootChange: (nextId: string) => void;
  onSearchTermChange: (value: string) => void;
  isLoading: boolean;
  isStartingScan: boolean;
  isScanActive: boolean;
  onRescan: () => void;
  onRecheckExtraction: () => void;
  onClearFilters: () => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
  showOnlyUntagged: boolean;
  onShowOnlyUntaggedChange: (value: boolean) => void;
};

export default function GalleryControlsDock({
  isOpen,
  onOpenChange,
  roots,
  imagesCount,
  totalImages,
  scannedAtLabel,
  selectedRootId,
  searchTerm,
  onRootChange,
  onSearchTermChange,
  isLoading,
  isStartingScan,
  isScanActive,
  onRescan,
  onRecheckExtraction,
  onClearFilters,
  sortOrder,
  onSortOrderChange,
  showOnlyUntagged,
  onShowOnlyUntaggedChange,
}: GalleryControlsDockProps) {
  const activeControlsCount =
    (selectedRootId !== "all" ? 1 : 0) + 
    (searchTerm.trim() !== "" ? 1 : 0) + 
    (sortOrder !== "none" ? 1 : 0) + 
    (showOnlyUntagged ? 1 : 0);

  // localStorage persistence stays in the consumer (app-specific)
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("galleryControlsDockOpen", String(isOpen));
    }
  }, [isOpen]);

  return (
    <DockPanel
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Control Dock"
      badgeCount={activeControlsCount}
      openLabel="Open controls"
      closeLabel="Close controls"
      testIdPrefix="gallery-controls-dock"
      size="md"
      toggleSlot={1}
      stackOrder={1}
      contentClassName="space-y-4"
    >
      {/* Library Info Section */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-ui-xs uppercase tracking-[0.14em] text-[color:var(--ui-ink-caption)]">
          <span aria-hidden="true">📚</span>
          <span>Library Info</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          <InfoChip className="shrink-0">Roots: {roots.length}</InfoChip>
          <InfoChip className="shrink-0">
            Images: {imagesCount}
            {totalImages > imagesCount ? ` / ${totalImages}` : ""}
          </InfoChip>
          <InfoChip className="shrink-0">{scannedAtLabel}</InfoChip>
        </div>
      </section>

      {/* Search & Filter Section */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-ui-xs uppercase tracking-[0.14em] text-[color:var(--ui-ink-caption)]">
          <span aria-hidden="true">🔍</span>
          <span>Search & Filter</span>
        </h3>
        <div className="space-y-2">
          <SelectInput
            id="gallery-root-filter-dock"
            data-testid="gallery-root-filter-dock"
            name="selectedRoot"
            value={selectedRootId}
            onChange={(event) => onRootChange(event.target.value)}
            className="min-h-10 w-full"
          >
            <option value="all">All roots</option>
            {roots.map((root) => (
              <option key={root.id} value={root.id} title={root.path}>
                {root.path}
              </option>
            ))}
          </SelectInput>
          <TextInput
            id="gallery-search-input-dock"
            data-testid="gallery-search-input-dock"
            name="fileNameSearch"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="File name contains"
            className="min-h-10 w-full"
          />
          <SelectInput
            id="gallery-sort-order-dock"
            data-testid="gallery-sort-order-dock"
            name="sortOrder"
            value={sortOrder}
            onChange={(event) => onSortOrderChange(event.target.value as SortOrder)}
            className="min-h-10 w-full"
          >
            <option value="none">No sorting</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </SelectInput>
          <OutlineButton
            id="gallery-show-untagged-dock"
            data-testid="gallery-show-untagged-dock"
            onClick={() => onShowOnlyUntaggedChange(!showOnlyUntagged)}
            variant={showOnlyUntagged ? "accent" : "ghost"}
            controlSize="lg"
            className="w-full"
          >
            {showOnlyUntagged ? "✓ " : ""}Show only untagged images
          </OutlineButton>
        </div>
      </section>

      {/* Library Actions Section */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-ui-xs uppercase tracking-[0.14em] text-[color:var(--ui-ink-caption)]">
          <span aria-hidden="true">⚙️</span>
          <span>Library Actions</span>
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
          <OutlineButton
            id="gallery-rescan-button-dock"
            data-testid="gallery-rescan-button-dock"
            onClick={onRescan}
            disabled={isLoading || isStartingScan || isScanActive}
            variant="ghost"
            controlSize="lg"
          >
            {isStartingScan ? "Starting..." : isScanActive ? "Scanning..." : "Rescan"}
          </OutlineButton>
          <OutlineButton
            id="gallery-recheck-extraction-button-dock"
            data-testid="gallery-recheck-extraction-button-dock"
            onClick={onRecheckExtraction}
            disabled={isLoading || isStartingScan || isScanActive}
            variant="ghost"
            controlSize="lg"
          >
            Recheck metadata
          </OutlineButton>
          <OutlineButton
            id="gallery-clear-filters-button-dock"
            data-testid="gallery-clear-filters-button-dock"
            onClick={onClearFilters}
            variant="ghost"
            controlSize="lg"
            className="sm:col-span-1"
          >
            Clear filters
          </OutlineButton>
        </div>
      </section>
    </DockPanel>
  );
}

