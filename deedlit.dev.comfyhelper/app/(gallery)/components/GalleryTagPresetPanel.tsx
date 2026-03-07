"use client";

import { OutlineButton, SelectInput, SurfacePanel, TextInput } from "@deedlit.dev/ui";
import type { TagFilterPreset } from "@/lib/library-types";
import { cn } from "@/lib/utils";

type GalleryTagPresetPanelProps = {
  tagFilterPresets: TagFilterPreset[];
  activeTagFilterPreset: TagFilterPreset | null;
  activeTagFilterPresetId: string;
  onActiveTagFilterPresetIdChange: (value: string) => void;
  isSavingTagPreset: boolean;
  isDeletingTagPresetId: string | null;
  presetPositiveTagDraft: string;
  onPresetPositiveTagDraftChange: (value: string) => void;
  presetNegativeTagDraft: string;
  onPresetNegativeTagDraftChange: (value: string) => void;
  newTagPresetName: string;
  onNewTagPresetNameChange: (value: string) => void;
  selectedPositiveTagCount: number;
  selectedNegativeTagCount: number;
  onAddTagToActivePreset: (kind: "positive" | "negative") => void;
  onUpdateActivePresetFromSelectedFilters: () => void;
  onCreateTagFilterPreset: () => void;
  onDeleteTagFilterPreset: (presetId: string) => void;
  isNested?: boolean;
};

export default function GalleryTagPresetPanel({
  tagFilterPresets,
  activeTagFilterPreset,
  activeTagFilterPresetId,
  onActiveTagFilterPresetIdChange,
  isSavingTagPreset,
  isDeletingTagPresetId,
  presetPositiveTagDraft,
  onPresetPositiveTagDraftChange,
  presetNegativeTagDraft,
  onPresetNegativeTagDraftChange,
  newTagPresetName,
  onNewTagPresetNameChange,
  selectedPositiveTagCount,
  selectedNegativeTagCount,
  onAddTagToActivePreset,
  onUpdateActivePresetFromSelectedFilters,
  onCreateTagFilterPreset,
  onDeleteTagFilterPreset,
  isNested = false,
}: GalleryTagPresetPanelProps) {
  return (
    <SurfacePanel
      id="gallery-tag-preset-panel"
      data-testid="gallery-tag-preset-panel"
      className={cn("rounded-2xl", isNested ? "mt-3" : "mt-4")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ui-xs uppercase tracking-[0.14em] text-[color:var(--ui-ink-caption)]">
          Tag Filter Presets
        </p>
        <p className="text-ui-xs text-[color:var(--ui-ink-subtle)]">
          Active: {activeTagFilterPreset ? activeTagFilterPreset.name : "None"}
        </p>
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <SelectInput
          id="gallery-tag-preset-select"
          data-testid="gallery-tag-preset-select"
          value={activeTagFilterPresetId}
          onChange={(event) => onActiveTagFilterPresetIdChange(event.target.value)}
          className="bg-panel/95"
        >
          <option value="none">No preset</option>
          {tagFilterPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name} (+{preset.positiveTags.length} / -{preset.negativeTags.length})
            </option>
          ))}
        </SelectInput>
        <OutlineButton
          onClick={() => onActiveTagFilterPresetIdChange("none")}
          disabled={activeTagFilterPresetId === "none"}
          className="rounded-xl px-3 py-2 text-ui-sm"
        >
          Clear preset
        </OutlineButton>
      </div>

      {activeTagFilterPreset && (
        <>
          <p className="mt-2 text-ui-xs text-[color:var(--ui-ink-subtle)]">
            Excluding images matching any preset tags ({activeTagFilterPreset.positiveTags.length} positive /{" "}
            {activeTagFilterPreset.negativeTags.length} negative).
          </p>
          <div className="mt-2 rounded-xl border border-[color:var(--ui-border-soft)] bg-panel/70 p-2">
            <p className="text-ui-xs uppercase tracking-[0.12em] text-[color:var(--ui-ink-caption)]">
              Update Active Preset
            </p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <TextInput
                  id="active-preset-add-positive-tag-input"
                  data-testid="active-preset-add-positive-tag-input"
                  value={presetPositiveTagDraft}
                  onChange={(event) => onPresetPositiveTagDraftChange(event.target.value)}
                  placeholder="Add positive tag(s)"
                  className="bg-panel/95"
                />
                <OutlineButton
                  onClick={() => onAddTagToActivePreset("positive")}
                  disabled={isSavingTagPreset}
                  className="rounded-xl px-3 py-2 text-ui-xs"
                >
                  Add +
                </OutlineButton>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <TextInput
                  id="active-preset-add-negative-tag-input"
                  data-testid="active-preset-add-negative-tag-input"
                  value={presetNegativeTagDraft}
                  onChange={(event) => onPresetNegativeTagDraftChange(event.target.value)}
                  placeholder="Add negative tag(s)"
                  className="bg-panel/95"
                />
                <OutlineButton
                  onClick={() => onAddTagToActivePreset("negative")}
                  disabled={isSavingTagPreset}
                  className="rounded-xl px-3 py-2 text-ui-xs"
                >
                  Add -
                </OutlineButton>
              </div>
            </div>
            <OutlineButton
              onClick={onUpdateActivePresetFromSelectedFilters}
              disabled={isSavingTagPreset}
              className="mt-2 rounded-xl px-3 py-2 text-ui-xs"
            >
              Merge current selected tags into preset (+{selectedPositiveTagCount} / -
              {selectedNegativeTagCount})
            </OutlineButton>
            <p className="mt-1 text-ui-xs text-[color:var(--ui-ink-faint)]">
              Supports comma-separated tag input.
            </p>
          </div>
        </>
      )}

      <div className="mt-3 rounded-xl border border-[color:var(--ui-border-soft)] bg-panel/70 p-2">
        <p className="text-ui-xs uppercase tracking-[0.12em] text-[color:var(--ui-ink-caption)]">
          Create From Current Tag Selection
        </p>
        <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <TextInput
            id="new-tag-preset-name"
            data-testid="new-tag-preset-name"
            value={newTagPresetName}
            onChange={(event) => onNewTagPresetNameChange(event.target.value)}
            placeholder="Preset name"
            className="bg-panel/95"
          />
          <OutlineButton
            onClick={onCreateTagFilterPreset}
            disabled={isSavingTagPreset}
            className="rounded-xl px-3 py-2 text-ui-sm"
          >
            {isSavingTagPreset ? "Saving..." : "Save preset"}
          </OutlineButton>
        </div>
        <p className="mt-1 text-ui-xs text-[color:var(--ui-ink-faint)]">
          Uses currently selected tags: +{selectedPositiveTagCount} / -{selectedNegativeTagCount}
        </p>
      </div>

      {tagFilterPresets.length > 0 && (
        <div className="mt-3 max-h-48 space-y-2 overflow-auto rounded-xl border border-[color:var(--ui-border-soft)] bg-panel/65 p-2">
          {tagFilterPresets.map((preset) => {
            const isActive = activeTagFilterPresetId === preset.id;
            return (
              <div
                key={preset.id}
                className={cn(
                  "rounded-lg border p-2",
                  isActive
                    ? "border-[color:var(--ui-border-active)] bg-[color:var(--ui-bg-active)]"
                    : "border-[color:var(--ui-border-strong)] bg-panel/90",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-ui-xs font-medium text-[color:var(--ui-ink-secondary)]">{preset.name}</p>
                  <div className="flex items-center gap-1">
                    <OutlineButton
                      onClick={() => onActiveTagFilterPresetIdChange(preset.id)}
                      className="rounded-md px-2 py-1 text-ui-xs text-[color:var(--ui-ink-secondary)]"
                    >
                      Apply
                    </OutlineButton>
                    <OutlineButton
                      onClick={() => onDeleteTagFilterPreset(preset.id)}
                      disabled={isDeletingTagPresetId === preset.id || isSavingTagPreset}
                      variant="danger"
                      className="rounded-md px-2 py-1 text-ui-xs text-rose-700 hover:bg-rose-100"
                    >
                      {isDeletingTagPresetId === preset.id ? "Removing..." : "Delete"}
                    </OutlineButton>
                  </div>
                </div>
                <p className="mt-1 text-ui-xs text-[color:var(--ui-ink-subtle)]">
                  +{preset.positiveTags.length} / -{preset.negativeTags.length}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </SurfacePanel>
  );
}





