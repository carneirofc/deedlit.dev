"use client";

import { useState } from "react";

import type { GraphScope } from "@/lib/library/schemas";

const NODE_TYPES = ["Tag", "Model", "Checkpoint", "LoRA", "Folder"] as const;
type NodeType = (typeof NODE_TYPES)[number];

const input =
  "rounded-lg border border-ui-border/70 bg-ui-bg px-2.5 py-2 text-ui-xs outline-none focus:border-accent-cyan";
const btn =
  "rounded-lg border border-ui-border/70 bg-ui-bg-soft px-2.5 py-2 text-ui-xs font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50";

/**
 * Builds a Neo4j graph-relationship scope (shared hub node, or "related to this
 * image") and reports it upward.  Previews the match count via the graph
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
  const [nodeType, setNodeType] = useState<NodeType>((value?.node?.type as NodeType) ?? "Model");
  const [text, setText] = useState(value?.node?.value ?? "");
  const [useRelated, setUseRelated] = useState(Boolean(value?.relatedToImageId));
  const [count, setCount] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  const apply = async () => {
    let scope: GraphScope | null = null;
    if (useRelated && relatedImageId) {
      scope = { relatedToImageId: relatedImageId, hops: 1 };
    } else if (text.trim()) {
      scope = { node: { type: nodeType, value: text.trim() }, hops: 1 };
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
      setCount(typeof j.count === "number" ? j.count : null);
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

      <div className={`flex flex-wrap items-center gap-2 ${useRelated ? "opacity-40" : ""}`}>
        <select
          className={input}
          value={nodeType}
          onChange={(e) => setNodeType(e.target.value as NodeType)}
          disabled={useRelated}
        >
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          className={`${input} min-w-[10rem] flex-1`}
          placeholder={nodeType === "Folder" ? "folder path…" : `${nodeType.toLowerCase()} name…`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
          disabled={useRelated}
        />
      </div>

      <div className="mt-2 flex gap-2">
        <button className={btn} onClick={apply} disabled={checking}>
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
