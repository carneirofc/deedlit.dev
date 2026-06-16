"use client";

import { useEffect, useRef, useState } from "react";

import { TagSelect } from "@deedlit.dev/ui";

import type { ExportKind } from "@/lib/library/bulk-export";

type SafetyClass = "sfw" | "nsfw" | "explicit";
const SAFETY_CLASSES: SafetyClass[] = ["sfw", "nsfw", "explicit"];
const SAFETY_LABEL: Record<SafetyClass, string> = {
  sfw: "SFW",
  nsfw: "NSFW",
  explicit: "Explicit",
};

/** Which bulk action is mid-flight (drives the busy/disabled state). */
export type BulkBusy = "favorite" | "rating" | "safety" | "tags" | "export" | "delete" | null;

const btn =
  "rounded-lg border border-ui-border/70 bg-ui-bg-soft px-3 py-2 text-ui-sm font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50";

interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  busy: BulkBusy;
  confirmingDelete: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onFavorite: (value: boolean) => void;
  /** Set a 0–5 rating; 0 clears the rating. */
  onRating: (value: number) => void;
  onSafety: (value: SafetyClass) => void;
  onAddTags: (tags: string[]) => void;
  onRemoveTags: (tags: string[]) => void;
  onExport: (kind: ExportKind) => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  fetchTagSuggestions: (q: string) => Promise<string[]>;
}

type MenuKey = "rating" | "safety" | "tags" | "export";

/**
 * The select-mode action bar: bulk metadata edits (favorite / rating / safety /
 * tags) + export + un-index over the current selection. Edits fan the per-image
 * PATCH route out client-side (see lib/library/bulk-patch); this component owns
 * only its menu/popover UI state and delegates the actual work to the page.
 */
export function BulkActionBar(props: BulkActionBarProps) {
  const {
    selectedCount,
    totalCount,
    busy,
    confirmingDelete,
    onSelectAll,
    onClear,
    onFavorite,
    onRating,
    onSafety,
    onAddTags,
    onRemoveTags,
    onExport,
    onRequestDelete,
    onConfirmDelete,
    onCancelDelete,
    fetchTagSuggestions,
  } = props;

  const none = selectedCount === 0;
  const anyBusy = busy !== null;

  // Single open menu at a time; click-away closes it.
  const [menu, setMenu] = useState<MenuKey | null>(null);
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const toggle = (key: MenuKey) => setMenu((m) => (m === key ? null : key));

  return (
    <div
      ref={rootRef}
      className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-accent-cyan/40 bg-ui-bg-soft/90 px-3 py-2 backdrop-blur-sm"
    >
      <span className="text-ui-sm font-medium text-ui-ink">{selectedCount} selected</span>
      <button className={btn} onClick={onSelectAll} disabled={selectedCount === totalCount}>
        Select all
      </button>
      <button className={btn} onClick={onClear} disabled={none}>
        Clear
      </button>

      <div className="flex-1" />

      {/* Favorite / unfavorite */}
      <button
        className={`${btn} flex items-center gap-1.5`}
        onClick={() => onFavorite(true)}
        disabled={none || anyBusy}
        title="Mark selected as favorite"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
          <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
        {busy === "favorite" ? "…" : "Favorite"}
      </button>
      <button
        className={btn}
        onClick={() => onFavorite(false)}
        disabled={none || anyBusy}
        title="Remove favorite from selected"
      >
        Unfavorite
      </button>

      {/* Rating */}
      <Menu label="Rating" open={menu === "rating"} onToggle={() => toggle("rating")} disabled={none || anyBusy} busy={busy === "rating"}>
        {[5, 4, 3, 2, 1].map((n) => (
          <MenuItem key={n} onClick={() => { onRating(n); setMenu(null); }}>
            {"★".repeat(n)}
            <span className="text-ui-ink-muted">{"☆".repeat(5 - n)}</span>
          </MenuItem>
        ))}
        <MenuItem onClick={() => { onRating(0); setMenu(null); }}>Clear rating</MenuItem>
      </Menu>

      {/* Safety class */}
      <Menu label="Safety" open={menu === "safety"} onToggle={() => toggle("safety")} disabled={none || anyBusy} busy={busy === "safety"}>
        {SAFETY_CLASSES.map((c) => (
          <MenuItem key={c} onClick={() => { onSafety(c); setMenu(null); }}>
            {SAFETY_LABEL[c]}
          </MenuItem>
        ))}
      </Menu>

      {/* Tags add / remove */}
      <Menu label="Tags" open={menu === "tags"} onToggle={() => toggle("tags")} disabled={none || anyBusy} busy={busy === "tags"} width="w-72">
        <div className="flex flex-col gap-2 p-2">
          <TagSelect
            value={tagDraft}
            onChange={setTagDraft}
            fetchSuggestions={fetchTagSuggestions}
            placeholder="type tags to add or remove…"
            variant="include"
          />
          <div className="flex gap-2">
            <button
              className={`${btn} flex-1`}
              disabled={tagDraft.length === 0}
              onClick={() => { onAddTags(tagDraft); setTagDraft([]); setMenu(null); }}
            >
              Add to selected
            </button>
            <button
              className={`${btn} flex-1`}
              disabled={tagDraft.length === 0}
              onClick={() => { onRemoveTags(tagDraft); setTagDraft([]); setMenu(null); }}
            >
              Remove
            </button>
          </div>
        </div>
      </Menu>

      {/* Export — complete canonical record vs. a simple basics-only subset. */}
      <Menu label={busy === "export" ? "Exporting…" : "Export"} open={menu === "export"} onToggle={() => toggle("export")} disabled={none || anyBusy} busy={busy === "export"} width="w-60">
        <MenuLabel>Complete record</MenuLabel>
        <MenuItem onClick={() => { onExport("complete-json"); setMenu(null); }}>JSON (.json)</MenuItem>
        <MenuItem onClick={() => { onExport("complete-jsonl"); setMenu(null); }}>JSON Lines (.jsonl)</MenuItem>
        <MenuLabel>Simple · id · sha · path · basics</MenuLabel>
        <MenuItem onClick={() => { onExport("simple-csv"); setMenu(null); }}>CSV (.csv)</MenuItem>
        <MenuItem onClick={() => { onExport("simple-json"); setMenu(null); }}>JSON (.json)</MenuItem>
        <MenuItem onClick={() => { onExport("simple-jsonl"); setMenu(null); }}>JSON Lines (.jsonl)</MenuItem>
      </Menu>

      {/* Un-index (delete from library) */}
      {!confirmingDelete ? (
        <button
          onClick={onRequestDelete}
          disabled={none || anyBusy}
          className="rounded-lg border border-rose-500/60 px-3 py-2 text-ui-sm font-medium text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-50"
        >
          Delete
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ui-xs text-ui-ink-muted">
            Remove {selectedCount} image{selectedCount === 1 ? "" : "s"} from the library? Originals on disk are kept.
          </span>
          <button
            onClick={onConfirmDelete}
            disabled={busy === "delete"}
            className="rounded-lg bg-rose-500/90 px-3 py-2 text-ui-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-60"
          >
            {busy === "delete" ? "Removing…" : "Remove"}
          </button>
          <button onClick={onCancelDelete} disabled={busy === "delete"} className={btn}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** A dropdown button + popover panel. */
function Menu({
  label,
  open,
  onToggle,
  disabled,
  busy,
  width = "w-44",
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  busy?: boolean;
  width?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        className={`${btn} flex items-center gap-1.5`}
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {label}
        <svg viewBox="0 0 24 24" className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && !busy && (
        <div className={`absolute right-0 z-30 mt-1 ${width} overflow-hidden rounded-lg border border-ui-border/70 bg-ui-bg-soft shadow-lg`} role="menu">
          {children}
        </div>
      )}
    </div>
  );
}

/** A non-interactive section heading inside a Menu popover. */
function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-b border-ui-border/40 bg-ui-bg/40 px-3 py-1.5 text-ui-2xs font-semibold uppercase tracking-wide text-ui-ink-muted first:rounded-t-lg">
      {children}
    </p>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-1 px-3 py-2 text-left text-ui-sm text-ui-ink transition hover:bg-accent-cyan/10"
    >
      {children}
    </button>
  );
}
