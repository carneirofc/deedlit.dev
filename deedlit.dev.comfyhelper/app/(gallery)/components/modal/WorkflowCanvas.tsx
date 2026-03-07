"use client";

/* eslint-disable react-hooks/refs -- workflow state includes refs used for DOM bindings. */

import { OutlineButton } from "@deedlit.dev/ui";
import type { WorkflowViewerState } from "../../hooks";
import type { WorkflowNodePalette } from "@/lib/gallery-types";
import { getWorkflowNodePalette } from "@/lib/metadata-utils";

const WORKFLOW_CANVAS_PADDING = 110;

type WorkflowCanvasProps = {
  workflow: WorkflowViewerState;
};

export default function WorkflowCanvas({ workflow }: WorkflowCanvasProps) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-bg-canvas)]">
      <div className="absolute left-2 top-2 z-20">
        <OutlineButton
          type="button"
          onClick={() => workflow.setShowWorkflowPanel((current) => !current)}
          className="rounded border border-[color:var(--ui-border-strong)] bg-[color:var(--ui-bg)]/90 px-2 py-1 text-ui-xs font-medium text-[color:var(--ui-ink-secondary)] transition hover:bg-[color:var(--ui-bg-soft)]"
        >
          {workflow.showWorkflowPanel ? "Hide panel" : "Show panel"}
        </OutlineButton>
      </div>

      <div
        ref={workflow.workflowViewportRef}
        className="h-full w-full touch-none cursor-grab active:cursor-grabbing"
        onWheel={workflow.handleWorkflowWheel}
        onPointerDown={(event) => {
          workflow.setSelectedWorkflowNodeId(null);
          workflow.handleWorkflowPointerDown(event);
        }}
        onPointerMove={workflow.handleWorkflowPointerMove}
        onPointerUp={workflow.handleWorkflowPointerUp}
        onPointerLeave={workflow.handleWorkflowPointerUp}
      >
        <div
          className="relative origin-top-left"
          style={{
            transform: `translate(${workflow.workflowOffsetX}px, ${workflow.workflowOffsetY}px) scale(${workflow.workflowScale})`,
            width: `${workflow.workflowCanvasBounds.width}px`,
            height: `${workflow.workflowCanvasBounds.height}px`,
          }}
        >
          <WorkflowEdges workflow={workflow} />
          <WorkflowNodes workflow={workflow} />
        </div>
      </div>
    </div>
  );
}

function WorkflowEdges({ workflow }: { workflow: WorkflowViewerState }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${workflow.workflowCanvasBounds.width} ${workflow.workflowCanvasBounds.height}`}
      preserveAspectRatio="none"
    >
      {workflow.visibleWorkflowEdges.map((edge) => {
        const source = workflow.visibleWorkflowNodeIndex.get(edge.fromNodeId);
        const target = workflow.visibleWorkflowNodeIndex.get(edge.toNodeId);
        if (!source || !target) return null;

        const sourceX =
          source.x - workflow.workflowCanvasBounds.minX + source.width + WORKFLOW_CANVAS_PADDING;
        const sourceIoSlots = Math.max(source.inputs.length, source.outputCount, 1);
        const sourceSlotHeight = Math.max(12, (source.height - 38) / sourceIoSlots);
        const sourceY =
          source.y -
          workflow.workflowCanvasBounds.minY +
          28 +
          sourceSlotHeight * (edge.fromOutputIndex + 0.5) +
          WORKFLOW_CANVAS_PADDING;
        const targetX =
          target.x - workflow.workflowCanvasBounds.minX + WORKFLOW_CANVAS_PADDING;
        const targetIoSlots = Math.max(target.inputs.length, target.outputCount, 1);
        const targetSlotHeight = Math.max(12, (target.height - 38) / targetIoSlots);
        const targetY =
          target.y -
          workflow.workflowCanvasBounds.minY +
          28 +
          targetSlotHeight * (edge.toInputIndex + 0.5) +
          WORKFLOW_CANVAS_PADDING;
        const controlX = Math.max(70, (targetX - sourceX) * 0.42);
        const isHighlighted =
          workflow.selectedWorkflowNodeId &&
          (edge.fromNodeId === workflow.selectedWorkflowNodeId ||
            edge.toNodeId === workflow.selectedWorkflowNodeId);
        const sourcePalette = getWorkflowNodePalette(source.type);

        return (
          <path
            key={edge.id}
            d={`M ${sourceX} ${sourceY} C ${sourceX + controlX} ${sourceY}, ${
              targetX - controlX
            } ${targetY}, ${targetX} ${targetY}`}
            stroke={isHighlighted ? sourcePalette.selectedBorder : sourcePalette.edge}
            strokeWidth={isHighlighted ? 2.3 : 1.5}
            fill="none"
            opacity={isHighlighted ? 0.96 : 0.78}
          />
        );
      })}
    </svg>
  );
}

function WorkflowNodes({ workflow }: { workflow: WorkflowViewerState }) {
  return (
    <>
      {workflow.visibleWorkflowNodes.map((node) => {
        const left = node.x - workflow.workflowCanvasBounds.minX + WORKFLOW_CANVAS_PADDING;
        const top = node.y - workflow.workflowCanvasBounds.minY + WORKFLOW_CANVAS_PADDING;
        const isSelected =
          (workflow.selectedWorkflowNodeId ?? workflow.visibleWorkflowNodes[0]?.id) === node.id;
        const palette = getWorkflowNodePalette(node.type);
        const previewInputs = node.inputs.filter((entry) => Boolean(entry.value)).slice(0, 4);

        return (
          <WorkflowNodeCard
            key={node.id}
            node={node}
            left={left}
            top={top}
            isSelected={isSelected}
            palette={palette}
            previewInputs={previewInputs}
            onSelect={() => workflow.setSelectedWorkflowNodeId(node.id)}
          />
        );
      })}
    </>
  );
}

type WorkflowNodeCardProps = {
  node: WorkflowViewerState["visibleWorkflowNodes"][number];
  left: number;
  top: number;
  isSelected: boolean;
  palette: WorkflowNodePalette;
  previewInputs: WorkflowViewerState["visibleWorkflowNodes"][number]["inputs"];
  onSelect: () => void;
};

function WorkflowNodeCard({
  node,
  left,
  top,
  isSelected,
  palette,
  previewInputs,
  onSelect,
}: WorkflowNodeCardProps) {
  return (
    <OutlineButton
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className="absolute rounded-lg border px-2 py-2 text-left shadow-sm transition"
      style={{
        left,
        top,
        width: node.width,
        minHeight: node.height,
        backgroundColor: isSelected ? palette.selectedBg : palette.bg,
        borderColor: isSelected ? palette.selectedBorder : palette.border,
        color: palette.text,
      }}
      title={`${node.title} (${node.type})`}
    >
      <p className="text-ui-xs font-semibold">
        #{node.id} {node.title}
      </p>
      <p className="mt-0.5 text-ui-2xs opacity-80">{node.type}</p>
      {node.note && (
        <p className="mt-1 line-clamp-2 text-ui-2xs opacity-85">{node.note}</p>
      )}
      <p className="mt-1 text-ui-2xs opacity-80">Inputs: {node.inputs.length}</p>
      {previewInputs.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {previewInputs.map((inputEntry, previewIndex) => (
            <p
              key={`${node.id}:preview:${inputEntry.name}:${previewIndex}`}
              className="line-clamp-2 break-all rounded bg-panel/55 px-1 py-0.5 text-ui-3xs opacity-95"
              title={`${inputEntry.name}: ${inputEntry.value ?? ""}`}
            >
              {inputEntry.name}: {inputEntry.value}
            </p>
          ))}
        </div>
      )}

      {/* Input ports */}
      <div className="pointer-events-none absolute left-0 top-7 bottom-2 flex flex-col justify-between">
        {node.inputs.map((inputEntry) => (
          <span
            key={`${node.id}:in:${inputEntry.index}`}
            className="ml-[-5px] block h-2.5 w-2.5 rounded-full border bg-panel"
            style={{ borderColor: palette.border }}
            title={inputEntry.name}
          />
        ))}
      </div>

      {/* Output ports */}
      <div className="pointer-events-none absolute right-0 top-7 bottom-2 flex flex-col justify-between">
        {Array.from({ length: Math.max(node.outputCount, 0) }).map((_, outputIndex) => (
          <span
            key={`${node.id}:out:${outputIndex}`}
            className="mr-[-5px] block h-2.5 w-2.5 rounded-full border"
            style={{
              borderColor: palette.selectedBorder,
              backgroundColor: palette.selectedBg,
            }}
          />
        ))}
      </div>
    </OutlineButton>
  );
}



