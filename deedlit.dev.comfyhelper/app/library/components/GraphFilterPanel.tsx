"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { GraphScope } from "@/lib/library/schemas";

// The node types that exist in the Neo4j projection (see deedlit.graph GRAPH
// MODEL): a Tag, or an Asset of one of these kinds. Each is autocomplete-backed
// by GET /api/library/graph/entities, so every type offers options to pick from
// instead of a blind free-text field. The label doubles as the asset `kind`
// (lowercased) the suggestion endpoint queries.
const NODE_TYPES = ["Tag", "Checkpoint", "LoRA", "Embedding", "VAE", "ControlNet", "Upscaler"] as const;
type NodeType = (typeof NODE_TYPES)[number];

const input =
  "rounded-lg border border-ui-border/70 bg-ui-bg px-2.5 py-2 text-ui-xs outline-none focus:border-accent-cyan";
const btn =
  "rounded-lg border border-ui-border/70 bg-ui-bg-soft px-2.5 py-2 text-ui-xs font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50";

/**
 * Single-value autocomplete over the graph's entities of a given type. Mirrors
 * the tag picker's UX (debounced server-backed suggestions, keyboard nav) but
 * for one value. Suggestions come from Neo4j via /api/library/graph/entities,
 * ranked most-used first; the user can still type a value that isn't listed.
 */
function EntitySuggest({
  type,
  value,
  onChange,
  onSelect,
  placeholder,
  disabled,
}: {
  /** Lowercased graph type/kind to fetch options for (tag, checkpoint, lora, …). */
  type: string;
  value: string;
  onChange: (v: string) => void;
  /** Commit a chosen/typed value (click a suggestion or press Enter). */
  onSelect: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  const listId = useId();

  // Debounced, server-backed options for the current (type, prefix). The latest
  // result wins; a stale in-flight one is dropped. Refetches when the type
  // changes too, so switching Tag → LoRA reloads that type's options.
  useEffect(() => {
    if (disabled || !open || !type) return;
    let alive = true;
    const ac = new AbortController();
    const handle = setTimeout(() => {
      fetch(
        `/api/library/graph/entities?type=${encodeURIComponent(type)}&prefix=${encodeURIComponent(value.trim())}&limit=50`,
        { signal: ac.signal },
      )
        .then((r) => (r.ok ? r.json() : { entities: [] }))
        .then((j) => { if (alive) setOptions(Array.isArray(j.entities) ? j.entities : []); })
        .catch(() => { /* keep the previous list on a transient failure */ });
    }, 150);
    return () => { alive = false; ac.abort(); clearTimeout(handle); };
  }, [type, value, open, disabled]);

  const choose = (v: string) => {
    onSelect(v);
    setOpen(false);
  };

  return (
    <div className="relative min-w-[10rem] flex-1">
      <input
        className={`${input} w-full`}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            choose(open && options[active] ? options[active] : value);
          } else if (e.key === "ArrowDown" && options.length) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp" && options.length) {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {open && !disabled && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-ui-border/70 bg-ui-bg-soft p-1 shadow-lg"
        >
          {options.map((o, i) => (
            <li key={o} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); choose(o); }}
                onMouseEnter={() => setActive(i)}
                className={`w-full truncate rounded-md px-2 py-1 text-left text-ui-xs transition ${
                  i === active ? "bg-accent-cyan/15 text-accent-cyan" : "text-ui-ink hover:bg-ui-bg"
                }`}
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Builds a Neo4j graph-relationship scope (shared hub node, or "related to this
 * image") and reports it upward. The hub-node VALUE is picked from a per-type
 * autocomplete sourced from the graph, so the user selects a real Tag/asset
 * instead of guessing its exact spelling. Previews the match count via the graph
 * neighbours endpoint so the user sees how constraining the scope is.
 */
export function GraphFilterPanel({
  value,
  onChange,
  relatedImageId,
}: {
  value: GraphScope | null;
  onChange: (scope: GraphScope | null) => void;
  relatedImageId?: string;
}) {
  const [nodeType, setNodeType] = useState<NodeType>((value?.node?.type as NodeType) ?? "Tag");
  const [text, setText] = useState(value?.node?.value ?? "");
  const [useRelated, setUseRelated] = useState(Boolean(value?.relatedToImageId));
  const [count, setCount] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  const apply = async (override?: string) => {
    const nodeValue = (override ?? text).trim();
    let scope: GraphScope | null = null;
    if (useRelated && relatedImageId) {
      scope = { relatedToImageId: relatedImageId, hops: 1 };
    } else if (nodeValue) {
      scope = { node: { type: nodeType, value: nodeValue }, hops: 1 };
    }
    onChange(scope);
    if (!scope) {
      setCount(null);
      return;
    }
    setChecking(true);
    try {
      const r = await fetch("/api/library/graph/neighbors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ graphScope: scope }),
      });
      const j = await r.json();
      // The scope-resolution endpoint is still a stub (returns unsupported); show
      // "active" rather than a misleading "0 matches" until it's wired.
      setCount(!j.unsupported && typeof j.count === "number" ? j.count : null);
    } catch {
      setCount(null);
    } finally {
      setChecking(false);
    }
  };

  const clear = () => {
    onChange(null);
    setText("");
    setUseRelated(false);
    setCount(null);
  };

  const active = value !== null;

  return (
    <div className="rounded-lg border border-ui-border/60 bg-ui-bg/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-ui-xs font-semibold text-ui-ink-title">Graph filter (Neo4j)</span>
        {active && (
          <span className="rounded-full bg-accent-cyan/15 px-2 py-0.5 text-ui-2xs text-accent-cyan">
            {checking ? "…" : count != null ? `${count} match${count === 1 ? "" : "es"}` : "active"}
          </span>
        )}
      </div>

      {relatedImageId && (
        <label className="mb-2 flex cursor-pointer items-center gap-1.5 text-ui-xs text-ui-ink">
          <input
            type="checkbox"
            checked={useRelated}
            onChange={(e) => setUseRelated(e.target.checked)}
            className="rounded"
          />
          Images sharing a tag/model with this one
        </label>
      )}

      <div className={`flex flex-wrap items-start gap-2 ${useRelated ? "opacity-40" : ""}`}>
        <select
          className={input}
          value={nodeType}
          onChange={(e) => { setNodeType(e.target.value as NodeType); setText(""); }}
          disabled={useRelated}
        >
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <EntitySuggest
          type={nodeType.toLowerCase()}
          value={text}
          onChange={setText}
          onSelect={(v) => { setText(v); void apply(v); }}
          placeholder={`${nodeType.toLowerCase()} name — pick from the list, or type…`}
          disabled={useRelated}
        />
      </div>

      <div className="mt-2 flex gap-2">
        <button className={btn} onClick={() => apply()} disabled={checking}>
          Apply filter
        </button>
        {active && (
          <button className={btn} onClick={clear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
