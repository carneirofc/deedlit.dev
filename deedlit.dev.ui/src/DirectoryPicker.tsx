"use client";

import { useCallback, useEffect, useState } from "react";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./Dialog";
import { ChevronRightIcon, DocumentIcon, FolderIcon } from "./Icons";
import OutlineButton from "./OutlineButton";

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface FsRoot {
  label: string;
  path: string;
}

interface FsBrowseResult {
  path: string | null;
  parent: string | null;
  separator: string;
  entries: FsEntry[];
  roots: FsRoot[];
}

/** Default endpoint that resolves a server-side filesystem listing. */
export const DEFAULT_FS_BROWSE_ENDPOINT = "/api/library/fs/browse";

export interface DirectoryPickerProps {
  open: boolean;
  /** Folder to open at first; falls back to the roots view when empty/invalid. */
  initialPath?: string;
  title?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
  /**
   * Endpoint that returns an {@link FsBrowseResult}. Called as
   * `${browseEndpoint}?path=<encoded>`; called with no query for the roots view.
   * Defaults to {@link DEFAULT_FS_BROWSE_ENDPOINT}.
   */
  browseEndpoint?: string;
}

/**
 * Modal that browses the server filesystem (via `browseEndpoint`) and returns
 * the absolute path of a chosen folder. Navigate into the target folder, then
 * confirm with "Select this folder".
 */
export function DirectoryPicker({
  open,
  initialPath,
  title = "Select a folder",
  onClose,
  onSelect,
  browseEndpoint = DEFAULT_FS_BROWSE_ENDPOINT,
}: DirectoryPickerProps) {
  const [data, setData] = useState<FsBrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const browse = useCallback(
    async (target: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const qs = target ? `?path=${encodeURIComponent(target)}` : "";
        const res = await fetch(`${browseEndpoint}${qs}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Unable to read folder.");
        // On success replace the view; on failure we keep the previous listing
        // (typically the roots view) so the picker stays navigable.
        setData(json as FsBrowseResult);
        setManual((json.path as string | null) ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to read folder.");
      } finally {
        setLoading(false);
      }
    },
    [browseEndpoint],
  );

  // On open: load the roots view first (always succeeds, populates drive
  // shortcuts), then try to descend into the current value if there is one.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      await browse(null);
      if (!cancelled && initialPath && initialPath.trim()) {
        await browse(initialPath.trim());
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally only re-run when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const current = data?.path ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent size="lg" data-testid="directory-picker">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Browse the server filesystem and choose a folder.</DialogDescription>
        </DialogHeader>

        <DialogBody>
      {/* Path bar: up · editable path · go */}
      <div className="flex flex-wrap items-center gap-2">
        <OutlineButton
          controlSize="sm"
          onClick={() => browse(data?.parent ?? null)}
          disabled={loading || !data?.path}
          tooltip="Up one level"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
          Up
        </OutlineButton>
        <input
          className="cyber-input min-w-[12rem] flex-1 rounded-lg px-3 py-2 font-mono text-ui-xs outline-none"
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") browse(manual.trim() || null);
          }}
          placeholder="Type or paste a folder path…"
          spellCheck={false}
          data-testid="directory-picker-path"
        />
        <OutlineButton controlSize="sm" onClick={() => browse(manual.trim() || null)} disabled={loading}>
          Go
        </OutlineButton>
      </div>

      {/* Quick roots */}
      {data?.roots?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.roots.map((root) => (
            <button
              key={root.path}
              type="button"
              onClick={() => browse(root.path)}
              className="rounded-full border border-ui-border bg-ui-bg-soft px-2.5 py-1 font-mono text-ui-2xs text-ui-ink-muted transition hover:border-accent-cyan hover:text-accent-cyan"
            >
              {root.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Listing */}
      <div className="mt-3 h-72 overflow-auto rounded-xl border border-ui-border bg-ui-bg/40 custom-scrollbar">
        {loading && !data ? (
          <p className="p-4 text-ui-sm text-ui-ink-muted">Loading…</p>
        ) : error ? (
          <p className="p-4 text-ui-sm text-error-ink">{error}</p>
        ) : !data || data.entries.length === 0 ? (
          <p className="p-4 text-ui-sm text-ui-ink-muted">This folder is empty.</p>
        ) : (
          <ul className="divide-y divide-ui-border/50">
            {data.entries.map((entry) =>
              entry.isDirectory ? (
                <li key={entry.path}>
                  <button
                    type="button"
                    onClick={() => browse(entry.path)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-ui-sm text-ui-ink transition hover:bg-accent-cyan/10"
                  >
                    <FolderIcon className="h-4 w-4 text-accent-cyan" />
                    <span className="truncate">{entry.name}</span>
                    <ChevronRightIcon className="ml-auto h-4 w-4 text-ui-ink-faint" />
                  </button>
                </li>
              ) : (
                <li
                  key={entry.path}
                  className="flex items-center gap-2 px-3 py-2 text-ui-sm text-ui-ink-faint"
                >
                  <DocumentIcon className="h-4 w-4" />
                  <span className="truncate">{entry.name}</span>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
        </DialogBody>

        <DialogFooter className="justify-between gap-3">
          <span
            className="min-w-0 flex-1 truncate font-mono text-ui-xs text-ui-ink-muted"
            title={current ?? undefined}
          >
            {current ?? "No folder selected"}
          </span>
          <div className="flex shrink-0 gap-2">
            <OutlineButton variant="ghost" onClick={onClose}>
              Cancel
            </OutlineButton>
            <OutlineButton
              variant="accent"
              disabled={!current}
              onClick={() => current && onSelect(current)}
            >
              Select this folder
            </OutlineButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DirectoryPicker;
