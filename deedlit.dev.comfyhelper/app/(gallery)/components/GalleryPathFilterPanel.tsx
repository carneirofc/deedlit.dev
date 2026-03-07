"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { OutlineButton, SurfacePanel } from "@deedlit.dev/ui";
import type { PathTreeNode } from "@/lib/gallery-types";
import { cn } from "@/lib/utils";

const PATHS_PER_PAGE = 30;

type GalleryPathFilterPanelProps = {
  selectedPathNode: string | null;
  deepestSelectedPath: PathTreeNode | null;
  deepestPathTreeNodes: PathTreeNode[];
  isNested?: boolean;
  onSelectPathNode: (value: string | null) => void;
};

export default function GalleryPathFilterPanel({
  selectedPathNode,
  deepestSelectedPath,
  deepestPathTreeNodes,
  isNested = false,
  onSelectPathNode,
}: GalleryPathFilterPanelProps) {
  const resetKey = useMemo(
    () => deepestPathTreeNodes.map((node) => node.key).join("|"),
    [deepestPathTreeNodes],
  );
  return (
    <SurfacePanel
      id="gallery-path-filter-panel"
      data-testid="gallery-path-filter-panel"
      className={cn(
        "rounded-2xl",
        isNested ? "mt-3" : "mt-4",
      )}
    >
      <p className="text-ui-xs uppercase tracking-[0.14em] text-[color:var(--ui-ink-secondary)]">
        Path Tree Filter
      </p>
      <div className="mt-2 flex flex-col gap-2">
        <OutlineButton
          onClick={() => onSelectPathNode(null)}
          className={cn(
            "w-fit rounded-lg border px-2 py-1 text-ui-xs transition",
            selectedPathNode === null
              ? "border-[color:var(--ui-border-active)] bg-[color:var(--ui-bg-active)] text-[color:var(--ui-ink-highlight)]"
              : "border-[color:var(--ui-border-strong)] bg-panel/80 text-[color:var(--ui-ink-secondary)] hover:bg-[color:var(--ui-bg-soft)]",
          )}
        >
          All paths
        </OutlineButton>
        {deepestSelectedPath && (
          <div className="space-y-2 rounded-xl border border-[color:var(--ui-border-soft)] bg-panel/65 p-2">
            <p className="text-ui-xs uppercase tracking-[0.12em] text-[color:var(--ui-ink-secondary)]">
              Current filter
            </p>
            <OutlineButton
              onClick={() => onSelectPathNode(deepestSelectedPath.key)}
              className="w-full rounded-lg border border-[color:var(--ui-border-active)] bg-[color:var(--ui-bg-active)] px-2 py-1 text-left text-ui-xs break-all text-[color:var(--ui-ink-highlight)]"
              title={deepestSelectedPath.displayPath}
            >
              {deepestSelectedPath.displayPath}
            </OutlineButton>
            {deepestSelectedPath.parentKey && (
              <OutlineButton
                onClick={() => onSelectPathNode(deepestSelectedPath.parentKey)}
                className="w-full rounded-lg border border-[color:var(--ui-border-strong)] bg-panel/80 px-2 py-1 text-left text-ui-xs text-[color:var(--ui-ink-secondary)] transition hover:bg-[color:var(--ui-bg-soft)]"
              >
                Go one level up
              </OutlineButton>
            )}
          </div>
        )}
      </div>

      <PathTreeNodeList
        key={resetKey}
        deepestPathTreeNodes={deepestPathTreeNodes}
        onSelectPathNode={onSelectPathNode}
      />
    </SurfacePanel>
  );
}

type PathTreeNodeListProps = {
  deepestPathTreeNodes: PathTreeNode[];
  onSelectPathNode: (value: string | null) => void;
};

function PathTreeNodeList({ deepestPathTreeNodes, onSelectPathNode }: PathTreeNodeListProps) {
  const [displayCount, setDisplayCount] = useState(PATHS_PER_PAGE);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const displayedNodes = useMemo(() => {
    return deepestPathTreeNodes.slice(0, displayCount);
  }, [deepestPathTreeNodes, displayCount]);

  const hasMore = displayedNodes.length < deepestPathTreeNodes.length;

  // Intersection observer for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setDisplayCount((prev) => prev + PATHS_PER_PAGE);
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore]);

  return (
    <div
      className="mt-3 max-h-52 space-y-2 overflow-auto rounded-xl border border-[color:var(--ui-border-soft)] bg-panel/65 p-2"
      ref={scrollContainerRef}
    >
      {deepestPathTreeNodes.length === 0 ? (
        <p className="text-ui-xs text-[color:var(--ui-ink-secondary)]">No deeper folders at this level.</p>
      ) : (
        <>
          {deepestPathTreeNodes.length > PATHS_PER_PAGE && (
            <div className="mb-1 flex items-center justify-between text-ui-3xs text-[color:var(--ui-ink-secondary)]">
              <span>
                Showing {displayedNodes.length} of {deepestPathTreeNodes.length} paths
              </span>
              {hasMore && <span>Scroll for more</span>}
            </div>
          )}
          {displayedNodes.map((node) => (
            <OutlineButton
              key={node.key}
              onClick={() => onSelectPathNode(node.key)}
              className="w-full rounded-lg border border-[color:var(--ui-border-strong)] bg-panel/90 px-2 py-1 text-left text-ui-xs text-[color:var(--ui-ink-secondary)] break-all transition hover:bg-[color:var(--ui-bg-soft)]"
              title={node.displayPath}
            >
              <span className="font-medium">{node.displayPath}</span>
              <span className="ml-2 text-[color:var(--ui-ink-secondary)]">({node.imageCount})</span>
            </OutlineButton>
          ))}
          {hasMore && <div ref={sentinelRef} className="h-1" />}
        </>
      )}
    </div>
  );
}




