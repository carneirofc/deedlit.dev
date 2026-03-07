"use client";

import type { FormEvent } from "react";

import {
  EmptyState,
  OutlineButton,
  Pagination,
  PanelSectionHeader,
  SelectInput,
  SurfacePanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
} from "@deedlit.dev/ui";
import type { ImageRecord } from "@/lib/library-types";
import { toFriendlyDate, toFriendlySize } from "@/lib/format-utils";

export type ScannedFilesPanelProps = {
  filesTotal: number;
  filesPage: number;
  totalFilePages: number;
  fileSearchInput: string;
  onFileSearchInputChange: (value: string) => void;
  onFileSearchSubmit: (event: FormEvent<HTMLFormElement>) => void;
  filesPageSize: number;
  onFilesPageSizeChange: (value: number) => void;
  onClearFileSearch: () => void;
  isFilesLoading: boolean;
  scannedFiles: ImageRecord[];
  onCopyFullPath: (image: ImageRecord) => void;
  onDeleteScannedFile: (image: ImageRecord) => void;
  deletingImageId: string | null;
  copiedPathId: string | null;
  onPrevPage: () => void;
  onNextPage: () => void;
};

export default function ScannedFilesPanel({
  filesTotal,
  filesPage,
  totalFilePages,
  fileSearchInput,
  onFileSearchInputChange,
  onFileSearchSubmit,
  filesPageSize,
  onFilesPageSizeChange,
  onClearFileSearch,
  isFilesLoading,
  scannedFiles,
  onCopyFullPath,
  onDeleteScannedFile,
  deletingImageId,
  copiedPathId,
  onPrevPage,
  onNextPage,
}: ScannedFilesPanelProps) {
  return (
    <SurfacePanel
      id="scanned-files-panel"
      data-testid="scanned-files-panel"
      tone="soft"
      className="mt-4"
    >
      <PanelSectionHeader
        title="Scanned Files"
        actions={
          <p className="text-ui-xs text-[color:var(--ui-ink-subtle)]">
            {filesTotal} total · page {filesPage} / {totalFilePages}
          </p>
        }
      />

      <form
        id="scanned-files-search-form"
        data-testid="scanned-files-search-form"
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={onFileSearchSubmit}
      >
        <TextInput
          id="scanned-files-search-input"
          data-testid="scanned-files-search-input"
          name="fileSearch"
          value={fileSearchInput}
          onChange={(event) => onFileSearchInputChange(event.target.value)}
          placeholder="Search file name or path"
          className="min-w-[220px] flex-1"
        />
        <SelectInput
          id="scanned-files-page-size-select"
          data-testid="scanned-files-page-size-select"
          name="filesPageSize"
          value={String(filesPageSize)}
          onChange={(event) => onFilesPageSizeChange(Number.parseInt(event.target.value, 10))}
          controlSize="sm"
        >
          <option value="10">10 / page</option>
          <option value="20">20 / page</option>
          <option value="40">40 / page</option>
          <option value="80">80 / page</option>
        </SelectInput>
        <OutlineButton type="submit" data-testid="scanned-files-search-button" controlSize="md">
          Search
        </OutlineButton>
        <OutlineButton
          onClick={onClearFileSearch}
          data-testid="scanned-files-clear-search-button"
          controlSize="md"
        >
          Clear
        </OutlineButton>
      </form>

      {isFilesLoading ? (
        <EmptyState tone="subtle" className="mt-3">Loading scanned files...</EmptyState>
      ) : scannedFiles.length === 0 ? (
        <EmptyState tone="subtle" className="mt-3">No cached files found for this query.</EmptyState>
      ) : (
        <div
          data-testid="scanned-files-table-container"
          className="mt-3 overflow-auto rounded-lg border border-[color:var(--ui-border-subtle)] bg-[color:var(--ui-bg-alt)]"
        >
          <Table>
            <TableHeader>
              <TableRow className="border-t-0">
                <TableHead>File</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Modified</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scannedFiles.map((file) => (
                <TableRow
                  key={file.id}
                  data-testid={`scanned-file-row-${file.id}`}
                >
                  <TableCell className="max-w-[260px] truncate font-medium text-[color:var(--ui-ink-title)]">
                    <a
                      href={`/api/image?path=${encodeURIComponent(file.absolutePath)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-[color:var(--ui-underline)] underline-offset-2 transition hover:text-[color:var(--ui-ink-hover)]"
                      title="Open image in new tab"
                    >
                      {file.fileName}
                    </a>
                  </TableCell>
                  <TableCell className="max-w-[520px] truncate text-[color:var(--ui-ink-note)]">
                    {file.relativePath}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[color:var(--ui-ink-meta)]">
                    {toFriendlySize(file.size)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[color:var(--ui-ink-meta)]">
                    {toFriendlyDate(file.modifiedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <OutlineButton
                        onClick={() => onCopyFullPath(file)}
                        data-testid={`copy-scanned-file-path-${file.id}`}
                        controlSize="xs"
                        className="text-ui-2xs"
                      >
                        {copiedPathId === file.id ? "Copied" : "Copy path"}
                      </OutlineButton>
                      <OutlineButton
                        onClick={() => onDeleteScannedFile(file)}
                        disabled={deletingImageId === file.id}
                        data-testid={`delete-scanned-file-${file.id}`}
                        variant="danger"
                        controlSize="xs"
                        className="text-ui-2xs"
                      >
                        {deletingImageId === file.id ? "Deleting..." : "Delete"}
                      </OutlineButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Pagination
        page={filesPage}
        totalPages={totalFilePages}
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
        disabled={isFilesLoading}
        testIdPrefix="scanned-files"
        className="mt-3"
      />
    </SurfacePanel>
  );
}





