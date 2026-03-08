"use client";

import type { FormEvent } from "react";

import { InfoChip, OutlineButton, PanelSectionHeader, SurfacePanel, TextAreaInput, TextInput } from "@deedlit.dev/ui";
import type { RootDirectory } from "@/lib/library-types";
import { toFriendlySize } from "@/lib/format-utils";

type SqliteInfo = {
  relativePath: string;
  absolutePath: string;
  fileSizeBytes: number | null;
  baseDirectory: string;
  profile: "dev" | "live";
} | null;

type DatabaseInfo = {
  tableRows: { rootDirectories: number; appSettings: number; imageCache: number; scanJobs: number };
  roots: { total: number; visible: number; hidden: number };
} | null;

type LibraryInfo = {
  visibleCachedImages: number;
} | null;

type SettingsPanelProps = {
  sqliteInfo: SqliteInfo;
  databaseInfo: DatabaseInfo;
  libraryInfo: LibraryInfo;
  roots: RootDirectory[];
  visibleRootCount: number;
  hiddenRootCount: number;
  galleryColumnsInput: string;
  onGalleryColumnsInputChange: (value: string) => void;
  galleryImageLimitInput: string;
  onGalleryImageLimitInputChange: (value: string) => void;
  excludedTagsInput: string;
  onExcludedTagsInputChange: (value: string) => void;
  excludedTagDraft: string;
  onExcludedTagDraftChange: (value: string) => void;
  normalizedExcludedTags: string[];
  onAddExcludedTag: () => void;
  trashcanDirectoryInput: string;
  onTrashcanDirectoryInputChange: (value: string) => void;
  onSaveSettings: () => void;
  busyAction: string | null;
  newRootPath: string;
  onNewRootPathChange: (value: string) => void;
  onAddRoot: (event: FormEvent<HTMLFormElement>) => void;
};

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-start justify-between gap-3 text-(--admin-muted) text-ui-xs">
      <span className="text-ui-ink-subtle">{label}</span>
      <span className="text-right text-ui-ink">{value}</span>
    </div>
  );
}

export default function SettingsPanel({
  sqliteInfo,
  databaseInfo,
  libraryInfo,
  roots,
  visibleRootCount,
  hiddenRootCount,
  galleryColumnsInput,
  onGalleryColumnsInputChange,
  galleryImageLimitInput,
  onGalleryImageLimitInputChange,
  excludedTagsInput,
  onExcludedTagsInputChange,
  excludedTagDraft,
  onExcludedTagDraftChange,
  normalizedExcludedTags,
  onAddExcludedTag,
  trashcanDirectoryInput,
  onTrashcanDirectoryInputChange,
  onSaveSettings,
  busyAction,
  newRootPath,
  onNewRootPathChange,
  onAddRoot,
}: SettingsPanelProps) {
  return (
    <aside
      id="admin-settings-panel"
      data-testid="admin-settings-panel"
      className="cyber-panel min-w-0 rounded-[28px] p-4 sm:p-5 xl:p-6"
    >
      <PanelSectionHeader title="Settings" description="Tune gallery defaults, storage paths, and parsing exclusions. Configuration is persisted in SQLite." />

      <div className="mt-4 flex flex-wrap gap-2">
        <InfoChip>Visible roots: {visibleRootCount}</InfoChip>
        <InfoChip>Hidden roots: {hiddenRootCount}</InfoChip>
        <InfoChip>Cached images: {libraryInfo?.visibleCachedImages ?? "Unknown"}</InfoChip>
        <InfoChip>DB size: {toFriendlySize(sqliteInfo?.fileSizeBytes ?? null)}</InfoChip>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <SurfacePanel className="min-w-0" padding="lg">
          <PanelSectionHeader
            title="Storage"
            description="Where app-owned runtime data is stored and how much persisted data is currently tracked."
          />
          <div className="mt-3 space-y-2">
            <DetailRow label="Storage base" value={sqliteInfo?.baseDirectory ?? "H:\\local-apps"} />
            <DetailRow label="Storage profile" value={sqliteInfo?.profile ?? "dev"} />
            <DetailRow label="Database path" value={sqliteInfo?.relativePath ?? "deedlit.dev.comfyhelper\\dev\\data\\comfyhelper.db"} />
            <div className="space-y-1 text-(--admin-muted) text-ui-xs">
              <p className="text-ui-ink-subtle">Absolute path</p>
              <p className="min-w-0 break-all text-ui-ink">{sqliteInfo?.absolutePath ?? "Unavailable"}</p>
            </div>
            <DetailRow label="root_directories rows" value={databaseInfo?.tableRows.rootDirectories ?? roots.length} />
            <DetailRow label="app_settings rows" value={databaseInfo?.tableRows.appSettings ?? "Unknown"} />
            <DetailRow label="image_cache rows" value={databaseInfo?.tableRows.imageCache ?? "Unknown"} />
            <DetailRow label="scan_jobs rows" value={databaseInfo?.tableRows.scanJobs ?? "Unknown"} />
          </div>
        </SurfacePanel>

        <SurfacePanel className="min-w-0" padding="lg">
          <PanelSectionHeader
            title="Library Snapshot"
            description="A compact view of how many roots and cached images the app can currently see."
          />
          <div className="mt-3 space-y-2">
            <DetailRow label="Configured roots" value={databaseInfo?.roots.total ?? roots.length} />
            <DetailRow label="Visible roots" value={databaseInfo?.roots.visible ?? visibleRootCount} />
            <DetailRow label="Hidden roots" value={databaseInfo?.roots.hidden ?? hiddenRootCount} />
            <DetailRow label="Cached images in visible roots" value={libraryInfo?.visibleCachedImages ?? "Unknown"} />
          </div>
        </SurfacePanel>
      </div>

      <div id="admin-settings-form" data-testid="admin-settings-form" className="mt-4 space-y-4">
        <SurfacePanel className="min-w-0" padding="lg">
          <PanelSectionHeader
            title="Gallery Defaults"
            description="Adjust the default desktop density and how many images the gallery can load at once."
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-ui-sm font-medium text-ui-ink" htmlFor="galleryColumns">
                Gallery columns (desktop+)
              </label>
              <TextInput
                id="galleryColumns"
                data-testid="gallery-columns-input"
                name="galleryColumns"
                value={galleryColumnsInput}
                onChange={(event) => onGalleryColumnsInputChange(event.target.value)}
                inputMode="numeric"
                className="mt-2 w-full"
              />
            </div>
            <div>
              <label className="block text-ui-sm font-medium text-ui-ink" htmlFor="galleryImageLimit">
                Gallery image limit
              </label>
              <TextInput
                id="galleryImageLimit"
                data-testid="gallery-image-limit-input"
                name="galleryImageLimit"
                value={galleryImageLimitInput}
                onChange={(event) => onGalleryImageLimitInputChange(event.target.value)}
                inputMode="numeric"
                className="mt-2 w-full"
              />
            </div>
          </div>
          <p className="mt-2 text-ui-xs text-ui-ink-subtle">
            Maximum gallery load range is 1000-50000. Higher limits increase memory use and first-load time.
          </p>
        </SurfacePanel>

        <SurfacePanel className="min-w-0" padding="lg">
          <PanelSectionHeader
            title="Trash Handling"
            description="Set the folder used by move-to-trash actions. Leave it empty to disable trash operations."
          />
          <label className="mt-3 block text-ui-sm font-medium text-ui-ink" htmlFor="trashcanDirectory">
            Trashcan directory
          </label>
          <TextInput
            id="trashcanDirectory"
            data-testid="trashcan-directory-input"
            name="trashcanDirectory"
            value={trashcanDirectoryInput}
            onChange={(event) => onTrashcanDirectoryInputChange(event.target.value)}
            placeholder="Uses storage profile trash directory by default"
            className="mt-2 w-full"
          />
          <p className="mt-2 text-ui-xs text-ui-ink-subtle">
            Leave empty to use the default profile trash folder under the configured storage base directory.
          </p>
        </SurfacePanel>

        <SurfacePanel className="min-w-0" padding="lg">
          <PanelSectionHeader
            title="Parsing Exclusions"
            description="Keep noisy prompt tags out of statistics and overall metadata parsing."
            actions={<InfoChip>Active: {normalizedExcludedTags.length}</InfoChip>}
          />
          <label className="mt-3 block text-ui-sm font-medium text-ui-ink" htmlFor="excludedTags">
            Statistics and parsing excluded tags
          </label>
          <TextAreaInput
            id="excludedTags"
            data-testid="stats-parsing-excluded-tags-input"
            name="excludedTags"
            value={excludedTagsInput}
            onChange={(event) => onExcludedTagsInputChange(event.target.value)}
            rows={6}
            placeholder={"unknown\nlow quality\nbroken_tag_example"}
            className="mt-2 w-full"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TextInput
              id="excludedTagDraft"
              data-testid="stats-parsing-excluded-tag-draft-input"
              name="excludedTagDraft"
              value={excludedTagDraft}
              onChange={(event) => onExcludedTagDraftChange(event.target.value)}
              placeholder="Add a noisy tag"
              className="min-w-45 flex-1"
            />
            <OutlineButton data-testid="add-excluded-tag-button" onClick={onAddExcludedTag}>
              Add tag
            </OutlineButton>
          </div>
          <div
            id="excluded-tags-preview"
            data-testid="excluded-tags-preview"
            className="mt-3 rounded-lg border border-ui-border-soft bg-panel/80 p-2"
          >
            <p className="ui-text-label-compact text-ui-ink-subtle">
              Active exclusions ({normalizedExcludedTags.length})
            </p>
            {normalizedExcludedTags.length === 0 ? (
              <p className="mt-1 text-ui-xs text-ui-ink-subtle">No exclusions configured.</p>
            ) : (
              <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-auto">
                {normalizedExcludedTags.slice(0, 40).map((tag) => (
                  <InfoChip
                    key={tag}
                    data-testid="excluded-tag-chip"
                    className="border border-ui-border-muted bg-ui-bg-soft px-2 py-0.5 text-ui-2xs text-ui-ink-accent"
                  >
                    {tag}
                  </InfoChip>
                ))}
              </div>
            )}
          </div>
        </SurfacePanel>

        <SurfacePanel className="min-w-0" padding="lg">
          <PanelSectionHeader
            title="Add Root Directory"
            description="Register another library path for future scans and gallery visibility."
          />
          <form id="add-root-form" data-testid="add-root-form" className="mt-3 flex flex-col gap-3" onSubmit={onAddRoot}>
            <TextInput
              id="rootPath"
              data-testid="root-path-input"
              name="rootPath"
              value={newRootPath}
              onChange={(event) => onNewRootPathChange(event.target.value)}
              placeholder="C:\\ComfyUI\\output"
              className="w-full"
            />
            <OutlineButton
              type="submit"
              id="add-root-button"
              data-testid="add-root-button"
              disabled={busyAction === "add-root"}
              variant="accent"
              controlSize="lg"
            >
              {busyAction === "add-root" ? "Adding..." : "Add root"}
            </OutlineButton>
          </form>
        </SurfacePanel>

        <OutlineButton
          id="save-settings-button"
          data-testid="save-settings-button"
          onClick={onSaveSettings}
          disabled={busyAction === "save-settings"}
          controlSize="lg"
          className="w-full"
        >
          {busyAction === "save-settings" ? "Saving..." : "Save settings"}
        </OutlineButton>
      </div>
    </aside>
  );
}






