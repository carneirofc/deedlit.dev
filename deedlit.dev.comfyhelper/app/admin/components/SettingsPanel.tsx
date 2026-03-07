"use client";

import type { FormEvent } from "react";

import { InfoChip, OutlineButton, SurfacePanel, TextAreaInput, TextInput } from "@deedlit.dev/ui";
import type { RootDirectory } from "@/lib/library-types";
import { toFriendlySize } from "@/lib/format-utils";

type SqliteInfo = {
  relativePath: string;
  absolutePath: string;
  fileSizeBytes: number | null;
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
      className="cyber-panel min-w-0 rounded-[28px] p-5"
    >
      <h2 className="text-ui-lg font-semibold text-[color:var(--ui-ink-strong)]">Settings</h2>
      <p className="mt-1 text-ui-sm text-[color:var(--ui-ink-muted)]">Configuration is persisted in SQLite.</p>

      <SurfacePanel className="mt-4 text-ui-xs text-[color:var(--admin-muted)]">
        <p className="font-semibold uppercase tracking-[0.08em] text-[color:var(--ui-ink-accent)]">
          SQLite Database File
        </p>
        <p className="mt-2">
          Relative: <code>{sqliteInfo?.relativePath ?? "data/comfyhelper.db"}</code>
        </p>
        <p className="mt-1 min-w-0 break-all">
          Absolute: <code className="break-all">{sqliteInfo?.absolutePath ?? "Unavailable"}</code>
        </p>
        <p className="mt-1">Size: {toFriendlySize(sqliteInfo?.fileSizeBytes ?? null)}</p>
      </SurfacePanel>

      <SurfacePanel className="mt-4 text-ui-xs text-[color:var(--admin-muted)]">
        <p className="font-semibold uppercase tracking-[0.08em] text-[color:var(--ui-ink-accent)]">
          Database Contents
        </p>
        <p className="mt-2">`root_directories` rows: {databaseInfo?.tableRows.rootDirectories ?? roots.length}</p>
        <p className="mt-1">`app_settings` rows: {databaseInfo?.tableRows.appSettings ?? "Unknown"}</p>
        <p className="mt-1">`image_cache` rows: {databaseInfo?.tableRows.imageCache ?? "Unknown"}</p>
        <p className="mt-1">`scan_jobs` rows: {databaseInfo?.tableRows.scanJobs ?? "Unknown"}</p>
        <p className="mt-2">Configured roots (all): {databaseInfo?.roots.total ?? roots.length}</p>
        <p className="mt-1">Configured roots (visible): {databaseInfo?.roots.visible ?? visibleRootCount}</p>
        <p className="mt-1">Configured roots (hidden): {databaseInfo?.roots.hidden ?? hiddenRootCount}</p>
        <p className="mt-2">Cached images in visible roots: {libraryInfo?.visibleCachedImages ?? "Unknown"}</p>
      </SurfacePanel>

      <SurfacePanel
        id="admin-settings-form"
        data-testid="admin-settings-form"
        className="mt-4"
      >
        <label className="mt-3 block text-ui-sm font-medium text-[color:var(--ui-ink)]" htmlFor="galleryColumns">
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
        <label className="mt-3 block text-ui-sm font-medium text-[color:var(--ui-ink)]" htmlFor="galleryImageLimit">
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
        <p className="mt-1 text-ui-xs text-[color:var(--ui-ink-subtle)]">
          Maximum number of images to load in the gallery (1000-50000). Higher values use more memory.
        </p>
        <label className="mt-3 block text-ui-sm font-medium text-[color:var(--ui-ink)]" htmlFor="trashcanDirectory">
          Trashcan directory
        </label>
        <TextInput
          id="trashcanDirectory"
          data-testid="trashcan-directory-input"
          name="trashcanDirectory"
          value={trashcanDirectoryInput}
          onChange={(event) => onTrashcanDirectoryInputChange(event.target.value)}
          placeholder="C:\\ComfyUI\\output\\_trash"
          className="mt-2 w-full"
        />
        <p className="mt-1 text-ui-xs text-[color:var(--ui-ink-subtle)]">
          Move-to-trash uses this folder. Leave blank to disable trash operations.
        </p>
        <label className="mt-3 block text-ui-sm font-medium text-[color:var(--ui-ink)]" htmlFor="excludedTags">
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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TextInput
            id="excludedTagDraft"
            data-testid="stats-parsing-excluded-tag-draft-input"
            name="excludedTagDraft"
            value={excludedTagDraft}
            onChange={(event) => onExcludedTagDraftChange(event.target.value)}
            placeholder="Add a noisy tag"
            className="min-w-[180px] flex-1"
          />
          <OutlineButton
            data-testid="add-excluded-tag-button"
            onClick={onAddExcludedTag}
          >
            Add tag
          </OutlineButton>
        </div>
        <p className="mt-1 text-ui-xs text-[color:var(--ui-ink-subtle)]">
          Tags in this list are ignored during statistics generation and overall prompt-tag parsing.
        </p>
        <div
          id="excluded-tags-preview"
          data-testid="excluded-tags-preview"
          className="mt-2 rounded-lg border border-[color:var(--ui-border-soft)] bg-panel/80 p-2"
        >
          <p className="ui-text-label-compact text-[color:var(--ui-ink-subtle)]">
            Active exclusions ({normalizedExcludedTags.length})
          </p>
          {normalizedExcludedTags.length === 0 ? (
            <p className="mt-1 text-ui-xs text-[color:var(--ui-ink-subtle)]">No exclusions configured.</p>
          ) : (
            <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-auto">
              {normalizedExcludedTags.slice(0, 40).map((tag) => (
                <InfoChip
                  key={tag}
                  data-testid="excluded-tag-chip"
                  className="border border-[color:var(--ui-border-muted)] bg-[color:var(--ui-bg-soft)] px-2 py-0.5 text-ui-2xs text-[color:var(--ui-ink-accent)]"
                >
                  {tag}
                </InfoChip>
              ))}
            </div>
          )}
        </div>
        <OutlineButton
          id="save-settings-button"
          data-testid="save-settings-button"
          onClick={onSaveSettings}
          disabled={busyAction === "save-settings"}
          controlSize="lg"
          className="mt-3 w-full"
        >
          {busyAction === "save-settings" ? "Saving..." : "Save settings"}
        </OutlineButton>
      </SurfacePanel>

      <form
        id="add-root-form"
        data-testid="add-root-form"
        className="mt-4 flex flex-col gap-3"
        onSubmit={onAddRoot}
      >
        <label className="text-ui-sm font-medium text-[color:var(--ui-ink)]" htmlFor="rootPath">
          Add root directory
        </label>
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
    </aside>
  );
}






