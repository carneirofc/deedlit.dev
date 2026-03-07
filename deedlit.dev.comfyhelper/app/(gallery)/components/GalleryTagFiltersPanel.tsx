"use client";

import { useMemo, useState, useRef, useEffect } from "react";

import { FilterSelectionCard, InfoChip, OutlineButton, SurfacePanel, TextInput } from "@deedlit.dev/ui";
import type { TagCount } from "@/lib/gallery-types";
import { cn } from "@/lib/utils";

const TAGS_PER_PAGE = 50;

type TagBucketFilterProps = {
  id: string;
  testId: string;
  title: string;
  variant?: "primary" | "compact";
  isNested?: boolean;
  fillHeight?: boolean;
  selectedTags: string[];
  allCounts: TagCount[];
  emptyLabel: string;
  searchTerm?: string;
  searchPlaceholder?: string;
  onSearchTermChange?: (value: string) => void;
  onToggleTag: (tag: string) => void;
};

function TagBucketFilter({
  id,
  testId,
  title,
  variant = "primary",
  isNested = false,
  fillHeight = false,
  selectedTags,
  allCounts,
  emptyLabel,
  searchTerm,
  searchPlaceholder,
  onSearchTermChange,
  onToggleTag,
}: TagBucketFilterProps) {
  const isCompact = variant === "compact";
  const fixedListSizeClass = isCompact
    ? isNested
      ? "min-h-24 max-h-[clamp(8rem,20vh,14rem)] p-2"
      : "max-h-32 p-1.5"
    : isNested
      ? "min-h-32 max-h-[clamp(10rem,24vh,16rem)] p-2.5"
      : "max-h-44 p-2";
  const listSizeClass = fillHeight
    ? cn("min-h-0 flex-1", isCompact ? "p-2" : "p-2.5")
    : fixedListSizeClass;
  const normalizedSearchTerm = searchTerm?.trim().toLowerCase() ?? "";
  const listKey = normalizedSearchTerm || "all-tags";

  const filteredCounts = useMemo(() => {
    if (!normalizedSearchTerm) return allCounts;
    return allCounts.filter((entry) =>
      entry.tag.toLowerCase().includes(normalizedSearchTerm),
    );
  }, [allCounts, normalizedSearchTerm]);

  return (
    <SurfacePanel
      id={id}
      data-testid={testId}
      className={cn(
        "min-w-0",
        fillHeight && "flex h-full min-h-0 flex-col",
        isCompact ? "rounded-xl p-2.5" : "rounded-2xl p-3",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 text-ui-2xs tracking-[0.14em] text-(--ui-ink-faint)">
          {title}
        </p>
        <InfoChip className="shrink-0 whitespace-nowrap px-1 py-0 text-ui-2xs text-(--ui-ink-faint)">
          {selectedTags.length} selected
        </InfoChip>
      </div>
      {onSearchTermChange && (
        <TextInput
          value={searchTerm ?? ""}
          onChange={(event) => onSearchTermChange(event.target.value)}
          placeholder={searchPlaceholder ?? "Search tags"}
          controlSize="sm"
          className={cn(
            "mt-2 w-full border-(--ui-border-modal) bg-panel/95 py-1",
            isCompact && "py-0.5",
          )}
        />
      )}
      <TagBucketList
        key={listKey}
        allCounts={allCounts}
        filteredCounts={filteredCounts}
        emptyLabel={emptyLabel}
        selectedTags={selectedTags}
        onToggleTag={onToggleTag}
        isCompact={isCompact}
        isNested={isNested}
        listSizeClass={listSizeClass}
      />
    </SurfacePanel>
  );
}

type TagBucketListProps = {
  allCounts: TagCount[];
  filteredCounts: TagCount[];
  emptyLabel: string;
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  isCompact: boolean;
  isNested: boolean;
  listSizeClass: string;
};

function TagBucketList({
  allCounts,
  filteredCounts,
  emptyLabel,
  selectedTags,
  onToggleTag,
  isCompact,
  isNested,
  listSizeClass,
}: TagBucketListProps) {
  const [displayCount, setDisplayCount] = useState(TAGS_PER_PAGE);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);

  const displayedCounts = useMemo(() => {
    return filteredCounts.slice(0, displayCount);
  }, [filteredCounts, displayCount]);

  const hasMore = displayedCounts.length < filteredCounts.length;

  // Intersection observer for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setDisplayCount((prev) => prev + TAGS_PER_PAGE);
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore]);

  return (
    <>
      {filteredCounts.length > TAGS_PER_PAGE && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <InfoChip className="px-1.5 py-0.5 text-ui-2xs text-[color:var(--ui-ink-faint)]">
            Showing {displayedCounts.length} of {filteredCounts.length} tags
          </InfoChip>
          {hasMore && (
            <span className="text-ui-2xs text-[color:var(--ui-ink-faint)]">
              Scroll for more
            </span>
          )}
        </div>
      )}
      <div
        ref={scrollContainerRef}
        className={cn(
          "custom-scrollbar mt-2 overflow-x-hidden overflow-y-auto rounded-xl border border-[color:var(--ui-border-soft)] bg-panel/65",
          listSizeClass,
        )}
      >
        {allCounts.length === 0 ? (
          <p className="text-ui-2xs text-[color:var(--ui-ink-subtle)]">
            {emptyLabel}
          </p>
        ) : filteredCounts.length === 0 ? (
          <p className="text-ui-2xs text-[color:var(--ui-ink-subtle)]">
            No tags match this search.
          </p>
        ) : (
          <div
            className={cn(
              "flex min-w-0 flex-wrap",
              isCompact ? "gap-1.5" : "gap-2",
            )}
          >
            {displayedCounts.map((entry) => (
              <OutlineButton
                key={entry.tag}
                onClick={() => onToggleTag(entry.tag)}
                className={cn(
                  "inline-flex max-w-full items-center rounded-full border transition",
                  isCompact
                    ? "gap-1 px-1.5 py-0 text-ui-2xs"
                    : "gap-1.5 px-2 py-0.5 text-ui-2xs",
                  selectedTagSet.has(entry.tag)
                    ? "border-[color:var(--ui-border-active)] bg-[color:var(--ui-bg-active)] text-[color:var(--ui-ink-highlight)]"
                    : "border-[color:var(--ui-border-strong)] bg-panel/90 text-[color:var(--ui-ink-secondary)] hover:bg-[color:var(--ui-bg-soft)]",
                )}
                title={entry.tag}
              >
                <span
                  className={cn(
                    "min-w-0 truncate",
                    isCompact
                      ? "max-w-[170px]"
                      : isNested
                        ? "max-w-[320px]"
                        : "max-w-[220px]",
                  )}
                >
                  {entry.tag}
                </span>
                <InfoChip
                  className={cn(
                    "shrink-0 bg-panel/80 text-[color:var(--ui-ink-faint)]",
                    "px-1 py-0 text-ui-2xs",
                  )}
                >
                  {entry.count}
                </InfoChip>
              </OutlineButton>
            ))}
            {hasMore && <div ref={sentinelRef} className="h-1 w-full" />}
          </div>
        )}
      </div>
    </>
  );
}

type GalleryTagFiltersPanelProps = {
  selectedPositiveTags: string[];
  selectedNegativeTags: string[];
  selectedModels: string[];
  positiveTagCounts: TagCount[];
  negativeTagCounts: TagCount[];
  modelCounts: TagCount[];
  onTogglePositiveTag: (tag: string) => void;
  onToggleNegativeTag: (tag: string) => void;
  onToggleModel: (tag: string) => void;
  isNested?: boolean;
};

export default function GalleryTagFiltersPanel({
  selectedPositiveTags,
  selectedNegativeTags,
  selectedModels,
  positiveTagCounts,
  negativeTagCounts,
  modelCounts,
  onTogglePositiveTag,
  onToggleNegativeTag,
  onToggleModel,
  isNested = false,
}: GalleryTagFiltersPanelProps) {
  const [positiveTagSearchTerm, setPositiveTagSearchTerm] = useState("");
  const [negativeTagSearchTerm, setNegativeTagSearchTerm] = useState("");

  const totalSelectedTags =
    selectedPositiveTags.length +
    selectedNegativeTags.length +
    selectedModels.length;

  return (
    <div
      id="gallery-tag-filters"
      data-testid="gallery-tag-filters"
      className={cn(
        "min-w-0",
        isNested ? "mt-2 flex h-full min-h-0 flex-col gap-2" : "mt-4 space-y-3",
      )}
    >
      {/* Selected Tags Summary */}
      {totalSelectedTags > 0 && (
        <div
          className={cn(
            "min-w-0 rounded-2xl border border-[color:var(--ui-border-active)] bg-[color:var(--ui-bg-active)] p-3",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <p className="text-ui-2xs font-medium uppercase tracking-[0.14em] text-[color:var(--ui-ink-faint)]">
              Active Filters
            </p>
            <InfoChip className="px-1.5 py-0.5 text-ui-2xs font-semibold text-[color:var(--ui-ink-highlight)]">
              {totalSelectedTags} total
            </InfoChip>
          </div>
          <div className="mt-2 space-y-2">
            {selectedPositiveTags.length > 0 && (
              <FilterSelectionCard
                testId="gallery-positive-active-filter-list"
                title={`Positive (${selectedPositiveTags.length}):`}
                items={selectedPositiveTags}
                onRemoveItem={onTogglePositiveTag}
                className="border-0 bg-transparent p-0"
                titleClassName="mb-1 font-medium normal-case tracking-normal text-[color:var(--ui-ink-secondary)]"
                listClassName="custom-scrollbar max-h-20 gap-1.5"
                chipClassName="group bg-panel/95 px-2 py-0.5 transition hover:border-red-300 hover:bg-red-50"
                itemLabelClassName="min-w-0 max-w-[180px]"
                removeIconClassName="text-ui-2xs group-hover:text-red-500"
                removeTitlePrefix="Remove"
              />
            )}
            {selectedNegativeTags.length > 0 && (
              <FilterSelectionCard
                testId="gallery-negative-active-filter-list"
                title={`Negative (${selectedNegativeTags.length}):`}
                items={selectedNegativeTags}
                onRemoveItem={onToggleNegativeTag}
                className="border-0 bg-transparent p-0"
                titleClassName="mb-1 font-medium normal-case tracking-normal text-[color:var(--ui-ink-secondary)]"
                listClassName="custom-scrollbar max-h-20 gap-1.5"
                chipClassName="group bg-panel/95 px-2 py-0.5 transition hover:border-red-300 hover:bg-red-50"
                itemLabelClassName="min-w-0 max-w-[180px]"
                removeIconClassName="text-ui-2xs group-hover:text-red-500"
                removeTitlePrefix="Remove"
              />
            )}
            {selectedModels.length > 0 && (
              <FilterSelectionCard
                testId="gallery-model-active-filter-list"
                title={`Models (${selectedModels.length}):`}
                items={selectedModels}
                onRemoveItem={onToggleModel}
                className="border-0 bg-transparent p-0"
                titleClassName="mb-1 font-medium normal-case tracking-normal text-[color:var(--ui-ink-secondary)]"
                listClassName="custom-scrollbar max-h-20 gap-1.5"
                chipClassName="group bg-panel/95 px-2 py-0.5 transition hover:border-red-300 hover:bg-red-50"
                itemLabelClassName="min-w-0 max-w-[180px]"
                removeIconClassName="text-ui-2xs group-hover:text-red-500"
                removeTitlePrefix="Remove"
              />
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          "grid gap-3",
          isNested ? "grid-cols-1 gap-2" : "[grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]",
        )}
      >
        <TagBucketFilter
          id="positive-tags-filter"
          testId="positive-tags-filter"
          title="Positive Tags"
          isNested={isNested}
          selectedTags={selectedPositiveTags}
          allCounts={positiveTagCounts}
          emptyLabel="No positive tags found."
          searchTerm={positiveTagSearchTerm}
          searchPlaceholder="Search positive tags"
          onSearchTermChange={setPositiveTagSearchTerm}
          onToggleTag={onTogglePositiveTag}
        />
        <TagBucketFilter
          id="negative-tags-filter"
          testId="negative-tags-filter"
          title="Negative Tags"
          isNested={isNested}
          selectedTags={selectedNegativeTags}
          allCounts={negativeTagCounts}
          emptyLabel="No negative tags found."
          searchTerm={negativeTagSearchTerm}
          searchPlaceholder="Search negative tags"
          onSearchTermChange={setNegativeTagSearchTerm}
          onToggleTag={onToggleNegativeTag}
        />
      </div>
      <div className={cn(isNested && "min-h-0 flex-1")}>
        <TagBucketFilter
          id="model-tags-filter"
          testId="model-tags-filter"
          title="Model Tags"
          variant="compact"
          isNested={isNested}
          fillHeight={isNested}
          selectedTags={selectedModels}
          allCounts={modelCounts}
          emptyLabel="No model tags found."
          onToggleTag={onToggleModel}
        />
      </div>
    </div>
  );
}

