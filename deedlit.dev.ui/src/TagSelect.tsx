"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "./utils";

export interface TagSelectProps {
  /** Currently selected tags (controlled). */
  value: string[];
  onChange: (next: string[]) => void;
  /** Candidate tags to autocomplete against (e.g. tags on loaded results). */
  suggestions?: string[];
  /**
   * Live, server-backed autocomplete. When provided, the dropdown is sourced by
   * calling this with the current draft (debounced) instead of `suggestions`, so
   * the type-ahead spans the whole tag catalog, not just loaded results. The
   * server is expected to prefix-match, so results are shown as-is (only
   * already-selected tags are removed).
   */
  fetchSuggestions?: (query: string) => Promise<string[]>;
  placeholder?: string;
  /** Accent: include filters glow cyan, exclude filters glow rose. */
  variant?: "include" | "exclude";
  /** Fired after the selection changes via the UI (add/remove) — e.g. to re-search. */
  onCommit?: (next: string[]) => void;
  /** Override the wrapper class. */
  className?: string;
}

const VARIANT = {
  include: {
    chip: "border-accent-cyan/50 bg-accent-cyan/15 text-accent-cyan",
    ring: "focus-within:border-accent-cyan",
  },
  exclude: {
    chip: "border-rose-500/50 bg-rose-500/15 text-rose-400",
    ring: "focus-within:border-rose-400",
  },
} as const;

/**
 * Chip multi-select with free-typing + autocomplete. Type and press Enter or
 * comma to add a tag; click a suggestion to add it; Backspace on an empty input
 * removes the last chip. Selection is deduped case-insensitively. Suggestions
 * are sourced by the caller (either a static `suggestions` list or a live
 * `fetchSuggestions`), already-selected tags are filtered out, and the list is
 * ranked in the order given.
 */
function TagSelect({
  value,
  onChange,
  suggestions = [],
  fetchSuggestions,
  placeholder = "add tag…",
  variant = "include",
  onCommit,
  className,
}: TagSelectProps) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const styles = VARIANT[variant];

  const has = (tag: string) =>
    value.some((v) => v.toLowerCase() === tag.toLowerCase());

  // Live server-backed suggestions: debounce the draft and fetch while the
  // dropdown is open. The latest result wins; a stale in-flight one is dropped.
  useEffect(() => {
    if (!fetchSuggestions || !open) return;
    let alive = true;
    const handle = setTimeout(() => {
      fetchSuggestions(draft.trim())
        .then((r) => { if (alive) setRemote(r); })
        .catch(() => { /* keep the previous list on a transient failure */ });
    }, 150);
    return () => { alive = false; clearTimeout(handle); };
  }, [draft, open, fetchSuggestions]);

  const filtered = useMemo(() => {
    const pool = fetchSuggestions ? remote : suggestions;
    const q = draft.trim().toLowerCase();
    const seen = new Set(value.map((v) => v.toLowerCase()));
    const out: string[] = [];
    for (const s of pool) {
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      // Local suggestions are substring-filtered here; remote ones are already
      // prefix-matched server-side, so they pass through (avoids mid-type flicker
      // while a debounced fetch catches up to the draft).
      if (!fetchSuggestions && q && !key.includes(q)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= 8) break;
    }
    return out;
  }, [suggestions, remote, fetchSuggestions, value, draft]);

  const commit = (next: string[]) => {
    onChange(next);
    onCommit?.(next);
  };

  const add = (raw: string) => {
    const tag = raw.trim();
    if (!tag || has(tag)) {
      setDraft("");
      return;
    }
    commit([...value, tag]);
    setDraft("");
    setActive(0);
  };

  const remove = (tag: string) => commit(value.filter((v) => v !== tag));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (open && filtered[active]) add(filtered[active]);
      else add(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      remove(value[value.length - 1]);
    } else if (e.key === "ArrowDown" && filtered.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp" && filtered.length) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-lg border border-ui-border/70 bg-ui-bg px-2 py-1.5 text-ui-sm outline-none transition",
          styles.ring,
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className={cn(
              "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-ui-2xs font-medium",
              styles.chip,
            )}
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(tag);
              }}
              aria-label={`Remove ${tag}`}
              className="opacity-70 transition hover:opacity-100"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : ""}
          className="min-w-[6rem] flex-1 bg-transparent text-ui-sm outline-none placeholder:text-ui-ink-muted"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
        />
      </div>

      {open && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-ui-border/70 bg-ui-bg-soft p-1 shadow-lg"
        >
          {filtered.map((s, i) => (
            <li key={s} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "w-full truncate rounded-md px-2 py-1 text-left text-ui-xs transition",
                  i === active ? "bg-accent-cyan/15 text-accent-cyan" : "text-ui-ink hover:bg-ui-bg",
                )}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default TagSelect;
