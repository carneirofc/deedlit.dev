"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { WorkflowDetails, WorkflowNodeEntry, WorkflowEdge } from "@/lib/gallery-types";

const WORKFLOW_CANVAS_PADDING = 110;
const WORKFLOW_PANEL_MIN_WIDTH = 220;
const WORKFLOW_PANEL_MAX_WIDTH = 560;

export type WorkflowViewerState = {
  // Search / filter
  workflowSearchTerm: string;
  setWorkflowSearchTerm: (term: string) => void;
  workflowNodeTypeFilter: string;
  setWorkflowNodeTypeFilter: (filter: string) => void;
  selectedWorkflowNodeId: string | null;
  setSelectedWorkflowNodeId: (id: string | null) => void;

  // Panel
  showWorkflowPanel: boolean;
  setShowWorkflowPanel: (show: boolean | ((current: boolean) => boolean)) => void;
  workflowPanelWidth: number;

  // Viewport transform
  workflowScale: number;
  setWorkflowScale: (scale: number | ((current: number) => number)) => void;
  workflowOffsetX: number;
  workflowOffsetY: number;

  // Computed data
  filteredWorkflowNodes: WorkflowNodeEntry[];
  workflowNodeTypes: string[];
  workflowNodeIndex: Map<string, WorkflowNodeEntry>;
  filteredWorkflowEdges: WorkflowEdge[];
  workflowCanvasBounds: { minX: number; minY: number; width: number; height: number };
  visibleWorkflowNodes: WorkflowNodeEntry[];
  visibleWorkflowNodeIndex: Map<string, WorkflowNodeEntry>;
  visibleWorkflowEdges: WorkflowEdge[];
  selectedWorkflowNode: WorkflowNodeEntry | null;

  // Refs
  workflowViewportRef: React.RefObject<HTMLDivElement | null>;

  // Event handlers
  handleWorkflowWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  handleWorkflowPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleWorkflowPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleWorkflowPointerUp: () => void;
  handleWorkflowPanelResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  handleWorkflowPanelResizePointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  handleWorkflowPanelResizePointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  fitWorkflowToViewport: () => void;
};

export function useWorkflowViewer(
  selectedWorkflowDetails: WorkflowDetails | null,
  selectedModalTab: "details" | "workflow" | "raw",
  selectedImageId: string | undefined,
): WorkflowViewerState {
  const [workflowSearchTerm, setWorkflowSearchTerm] = useState("");
  const [workflowNodeTypeFilter, setWorkflowNodeTypeFilter] = useState("all");
  const [selectedWorkflowNodeId, setSelectedWorkflowNodeId] = useState<string | null>(null);
  const [showWorkflowPanel, setShowWorkflowPanel] = useState(true);
  const [workflowPanelWidth, setWorkflowPanelWidth] = useState<number>(288);
  const [workflowViewportSize, setWorkflowViewportSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [workflowScale, setWorkflowScale] = useState<number>(0.65);
  const [workflowOffsetX, setWorkflowOffsetX] = useState<number>(40);
  const [workflowOffsetY, setWorkflowOffsetY] = useState<number>(40);

  const workflowViewportRef = useRef<HTMLDivElement | null>(null);
  const workflowDragRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    baseOffsetX: number;
    baseOffsetY: number;
  } | null>(null);
  const workflowPanRafRef = useRef<number | null>(null);
  const workflowPendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const workflowPanelResizeRef = useRef<{ startX: number; baseWidth: number } | null>(null);

  // ── Computed data ─────────────────────────────────────────────────

  const filteredWorkflowNodes = useMemo(() => {
    if (!selectedWorkflowDetails) return [];
    const query = workflowSearchTerm.trim().toLowerCase();
    return selectedWorkflowDetails.nodes.filter((node) => {
      if (workflowNodeTypeFilter !== "all" && node.type !== workflowNodeTypeFilter) return false;
      if (query && !node.searchText.includes(query)) return false;
      return true;
    });
  }, [selectedWorkflowDetails, workflowSearchTerm, workflowNodeTypeFilter]);

  const workflowNodeTypes = useMemo(() => {
    if (!selectedWorkflowDetails) return [];
    return Array.from(new Set(selectedWorkflowDetails.nodes.map((n) => n.type))).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [selectedWorkflowDetails]);

  const workflowNodeIndex = useMemo(() => {
    return new Map(filteredWorkflowNodes.map((n) => [n.id, n]));
  }, [filteredWorkflowNodes]);

  const filteredWorkflowEdges = useMemo(() => {
    if (!selectedWorkflowDetails) return [];
    return selectedWorkflowDetails.edges.filter(
      (edge) => workflowNodeIndex.has(edge.fromNodeId) && workflowNodeIndex.has(edge.toNodeId),
    );
  }, [selectedWorkflowDetails, workflowNodeIndex]);

  const workflowCanvasBounds = useMemo(() => {
    if (filteredWorkflowNodes.length === 0) {
      return { minX: 0, minY: 0, width: 1200, height: 800 };
    }
    const minX = filteredWorkflowNodes.reduce((c, n) => Math.min(c, n.x), Infinity);
    const minY = filteredWorkflowNodes.reduce((c, n) => Math.min(c, n.y), Infinity);
    const maxX = filteredWorkflowNodes.reduce((c, n) => Math.max(c, n.x + n.width), -Infinity);
    const maxY = filteredWorkflowNodes.reduce((c, n) => Math.max(c, n.y + n.height), -Infinity);
    return {
      minX,
      minY,
      width: Math.max(1000, maxX - minX + 220),
      height: Math.max(700, maxY - minY + 220),
    };
  }, [filteredWorkflowNodes]);

  const visibleWorkflowNodes = useMemo(() => {
    if (workflowViewportSize.width <= 0 || workflowViewportSize.height <= 0 || workflowScale <= 0) {
      return filteredWorkflowNodes;
    }
    const margin = 220;
    const viewLeft = -workflowOffsetX / workflowScale - margin;
    const viewTop = -workflowOffsetY / workflowScale - margin;
    const viewRight = (workflowViewportSize.width - workflowOffsetX) / workflowScale + margin;
    const viewBottom = (workflowViewportSize.height - workflowOffsetY) / workflowScale + margin;
    return filteredWorkflowNodes.filter((node) => {
      const left = node.x - workflowCanvasBounds.minX + WORKFLOW_CANVAS_PADDING;
      const top = node.y - workflowCanvasBounds.minY + WORKFLOW_CANVAS_PADDING;
      const right = left + node.width;
      const bottom = top + node.height;
      return right >= viewLeft && left <= viewRight && bottom >= viewTop && top <= viewBottom;
    });
  }, [
    filteredWorkflowNodes,
    workflowViewportSize.width,
    workflowViewportSize.height,
    workflowOffsetX,
    workflowOffsetY,
    workflowScale,
    workflowCanvasBounds.minX,
    workflowCanvasBounds.minY,
  ]);

  const visibleWorkflowNodeIndex = useMemo(() => {
    return new Map(visibleWorkflowNodes.map((n) => [n.id, n]));
  }, [visibleWorkflowNodes]);

  const visibleWorkflowEdges = useMemo(() => {
    return filteredWorkflowEdges.filter(
      (e) => visibleWorkflowNodeIndex.has(e.fromNodeId) && visibleWorkflowNodeIndex.has(e.toNodeId),
    );
  }, [filteredWorkflowEdges, visibleWorkflowNodeIndex]);

  const selectedWorkflowNode = useMemo(() => {
    if (!selectedWorkflowNodeId) return null;
    return workflowNodeIndex.get(selectedWorkflowNodeId) ?? null;
  }, [selectedWorkflowNodeId, workflowNodeIndex]);

  // ── Fit to viewport ───────────────────────────────────────────────

  const fitWorkflowToViewport = useCallback(() => {
    const viewport = workflowViewportRef.current;
    if (!viewport) return;
    const viewWidth = viewport.clientWidth;
    const viewHeight = viewport.clientHeight;
    if (viewWidth <= 0 || viewHeight <= 0) return;
    const padding = 36;
    const scaleX = (viewWidth - padding * 2) / workflowCanvasBounds.width;
    const scaleY = (viewHeight - padding * 2) / workflowCanvasBounds.height;
    const nextScale = Math.min(1.4, Math.max(0.22, Math.min(scaleX, scaleY)));
    const centeredOffsetX = (viewWidth - workflowCanvasBounds.width * nextScale) / 2;
    const centeredOffsetY = (viewHeight - workflowCanvasBounds.height * nextScale) / 2;
    setWorkflowScale(nextScale);
    setWorkflowOffsetX(centeredOffsetX);
    setWorkflowOffsetY(centeredOffsetY);
  }, [workflowCanvasBounds.height, workflowCanvasBounds.width]);

  // ── Panel width ───────────────────────────────────────────────────

  const updateWorkflowPanelWidth = useCallback((nextWidth: number) => {
    setWorkflowPanelWidth(
      Math.min(WORKFLOW_PANEL_MAX_WIDTH, Math.max(WORKFLOW_PANEL_MIN_WIDTH, nextWidth)),
    );
  }, []);

  // ── Event handlers ────────────────────────────────────────────────

  const handleWorkflowWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const viewport = workflowViewportRef.current;
      if (!viewport) return;

      const rect = viewport.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;

      const zoomFactor = event.deltaY < 0 ? 1.08 : 0.92;
      const nextScale = Math.min(1.8, Math.max(0.24, workflowScale * zoomFactor));
      if (nextScale === workflowScale) return;

      const worldX = (cursorX - workflowOffsetX) / workflowScale;
      const worldY = (cursorY - workflowOffsetY) / workflowScale;
      const nextOffsetX = cursorX - worldX * nextScale;
      const nextOffsetY = cursorY - worldY * nextScale;

      setWorkflowScale(nextScale);
      setWorkflowOffsetX(nextOffsetX);
      setWorkflowOffsetY(nextOffsetY);
    },
    [workflowScale, workflowOffsetX, workflowOffsetY],
  );

  const handleWorkflowPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      workflowDragRef.current = {
        dragging: true,
        startX: event.clientX,
        startY: event.clientY,
        baseOffsetX: workflowOffsetX,
        baseOffsetY: workflowOffsetY,
      };
    },
    [workflowOffsetX, workflowOffsetY],
  );

  const handleWorkflowPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = workflowDragRef.current;
      if (!dragState?.dragging) return;
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      workflowPendingPanRef.current = {
        x: dragState.baseOffsetX + deltaX,
        y: dragState.baseOffsetY + deltaY,
      };
      if (workflowPanRafRef.current === null) {
        workflowPanRafRef.current = window.requestAnimationFrame(() => {
          workflowPanRafRef.current = null;
          if (!workflowPendingPanRef.current) return;
          setWorkflowOffsetX(workflowPendingPanRef.current.x);
          setWorkflowOffsetY(workflowPendingPanRef.current.y);
        });
      }
    },
    [],
  );

  const handleWorkflowPointerUp = useCallback(() => {
    if (workflowDragRef.current) workflowDragRef.current.dragging = false;
    if (workflowPanRafRef.current !== null) {
      window.cancelAnimationFrame(workflowPanRafRef.current);
      workflowPanRafRef.current = null;
    }
    if (workflowPendingPanRef.current) {
      setWorkflowOffsetX(workflowPendingPanRef.current.x);
      setWorkflowOffsetY(workflowPendingPanRef.current.y);
    }
    workflowPendingPanRef.current = null;
  }, []);

  const handleWorkflowPanelResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      workflowPanelResizeRef.current = {
        startX: event.clientX,
        baseWidth: workflowPanelWidth,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [workflowPanelWidth],
  );

  const handleWorkflowPanelResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const resizeState = workflowPanelResizeRef.current;
      if (!resizeState) return;
      event.preventDefault();
      const delta = event.clientX - resizeState.startX;
      updateWorkflowPanelWidth(resizeState.baseWidth + delta);
    },
    [updateWorkflowPanelWidth],
  );

  const handleWorkflowPanelResizePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      workflowPanelResizeRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  const resetWorkflowState = useCallback(() => {
    setWorkflowSearchTerm("");
    setWorkflowNodeTypeFilter("all");
    setSelectedWorkflowNodeId(null);
    setShowWorkflowPanel(true);
    setWorkflowPanelWidth(288);
    setWorkflowScale(0.65);
    setWorkflowOffsetX(40);
    setWorkflowOffsetY(40);
  }, []);

  // ── Effects ───────────────────────────────────────────────────────

  // Reset workflow state on image change
  useEffect(() => {
    queueMicrotask(resetWorkflowState);
  }, [selectedImageId, resetWorkflowState]);

  // Auto-fit on tab / filter change
  useEffect(() => {
    if (selectedModalTab !== "workflow" || filteredWorkflowNodes.length === 0) return;
    const frame = window.requestAnimationFrame(() => fitWorkflowToViewport());
    return () => window.cancelAnimationFrame(frame);
  }, [
    selectedModalTab,
    workflowNodeTypeFilter,
    workflowSearchTerm,
    filteredWorkflowNodes.length,
    fitWorkflowToViewport,
  ]);

  // Sync viewport size
  useEffect(() => {
    const viewport = workflowViewportRef.current;
    if (!viewport) return;
    const syncViewport = () => {
      setWorkflowViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    };
    syncViewport();
    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (!size) return;
      setWorkflowViewportSize({ width: size.width, height: size.height });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [selectedModalTab, showWorkflowPanel, selectedImageId]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (workflowPanRafRef.current !== null) {
        window.cancelAnimationFrame(workflowPanRafRef.current);
        workflowPanRafRef.current = null;
      }
    };
  }, []);

  return {
    workflowSearchTerm,
    setWorkflowSearchTerm,
    workflowNodeTypeFilter,
    setWorkflowNodeTypeFilter,
    selectedWorkflowNodeId,
    setSelectedWorkflowNodeId,
    showWorkflowPanel,
    setShowWorkflowPanel,
    workflowPanelWidth,
    workflowScale,
    setWorkflowScale,
    workflowOffsetX,
    workflowOffsetY,
    filteredWorkflowNodes,
    workflowNodeTypes,
    workflowNodeIndex,
    filteredWorkflowEdges,
    workflowCanvasBounds,
    visibleWorkflowNodes,
    visibleWorkflowNodeIndex,
    visibleWorkflowEdges,
    selectedWorkflowNode,
    workflowViewportRef,
    handleWorkflowWheel,
    handleWorkflowPointerDown,
    handleWorkflowPointerMove,
    handleWorkflowPointerUp,
    handleWorkflowPanelResizePointerDown,
    handleWorkflowPanelResizePointerMove,
    handleWorkflowPanelResizePointerUp,
    fitWorkflowToViewport,
  };
}
