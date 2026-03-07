"use client";

import {
  FilterSelectionCard,
  InfoChip,
  OutlineButton,
  SegmentedControl,
} from "@deedlit.dev/ui";

type GalleryActiveFiltersBarProps = {
  selectedPositiveTags: string[];
  selectedNegativeTags: string[];
  selectedModels: string[];
  tagLogicalMode: "and" | "or";
  isNested?: boolean;
  onTagLogicalModeChange: (value: "and" | "or") => void;
  onResetFilters: () => void;
  onTogglePositiveTag: (tag: string) => void;
  onToggleNegativeTag: (tag: string) => void;
  onToggleModelTag: (tag: string) => void;
};

export default function GalleryActiveFiltersBar({
  selectedPositiveTags,
  selectedNegativeTags,
  selectedModels,
  tagLogicalMode,
  isNested = false,
  onTagLogicalModeChange,
  onResetFilters,
  onTogglePositiveTag,
  onToggleNegativeTag,
  onToggleModelTag,
}: GalleryActiveFiltersBarProps) {
  return (
    <div
      id="gallery-active-tag-filters-bar"
      data-testid="gallery-active-tag-filters-bar"
      className={
        isNested
          ? "mt-2 rounded-xl border border-[color:var(--ui-border-soft)] bg-panel/80 p-2.5"
          : "sticky top-2 z-20 mt-4 rounded-xl border border-[color:var(--ui-border-soft)] bg-panel/80 p-2.5 backdrop-blur sm:top-3"
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-ui-2xs font-medium uppercase tracking-[0.16em] text-[color:var(--ui-ink-faint)]">
            Active Filters
          </p>
          <InfoChip className="px-1 py-0 text-ui-2xs text-[color:var(--ui-ink-faint)]">
            +{selectedPositiveTags.length} / -{selectedNegativeTags.length}
          </InfoChip>
          {selectedModels.length > 0 ? (
            <InfoChip className="px-1 py-0 text-ui-2xs text-[color:var(--ui-ink-faint)]">
              Models {selectedModels.length}
            </InfoChip>
          ) : null}
        </div>

        <div className="flex w-full items-center gap-1.5 sm:w-auto">
          <SegmentedControl
            value={tagLogicalMode}
            onValueChange={onTagLogicalModeChange}
            className="w-full sm:w-auto"
            options={[
              {
                value: "and",
                label: "AND",
                testId: "gallery-tag-logical-mode-and",
              },
              {
                value: "or",
                label: "OR",
                testId: "gallery-tag-logical-mode-or",
              },
            ]}
          />
          <OutlineButton
            data-testid="gallery-tag-filters-reset"
            onClick={onResetFilters}
            className="rounded-md px-2 py-0.5"
          >
            Reset
          </OutlineButton>
        </div>
      </div>

      <div className={isNested ? "mt-2 grid gap-2" : "mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3"}>
        <FilterSelectionCard
          testId="gallery-active-positive-tags"
          title="Positive Tags"
          items={selectedPositiveTags}
          onRemoveItem={onTogglePositiveTag}
          removeTitlePrefix="Remove positive tag"
        />
        <FilterSelectionCard
          testId="gallery-active-negative-tags"
          title="Negative Tags"
          items={selectedNegativeTags}
          onRemoveItem={onToggleNegativeTag}
          removeTitlePrefix="Remove negative tag"
        />
        <FilterSelectionCard
          testId="gallery-active-model-tags"
          title="Model Tags"
          items={selectedModels}
          onRemoveItem={onToggleModelTag}
          removeTitlePrefix="Remove model tag"
        />
      </div>
    </div>
  );
}

