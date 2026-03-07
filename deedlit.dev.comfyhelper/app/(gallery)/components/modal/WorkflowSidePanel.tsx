"use client";

import { InfoChip, OutlineButton, SectionLabel, SelectInput, TextInput } from "@deedlit.dev/ui";
import type { WorkflowViewerState } from "../../hooks";
import type { WorkflowDetails, WorkflowNodeEntry } from "@/lib/gallery-types";

type WorkflowSidePanelProps = {
  workflow: WorkflowViewerState;
  workflowDetails: WorkflowDetails;
};

function NodeDetailView({ node }: { node: WorkflowNodeEntry }) {
  return (
    <div className="space-y-2">
      <p className="text-ui-xs font-semibold text-ui-ink-secondary">
        #{node.id} {node.title}
        <span className="ml-1 text-ui-xs font-normal text-ui-ink-subtle">
          ({node.type})
        </span>
      </p>

      {node.note && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-warn p-2 text-ui-xs text-(--ui-ink-primary)">
          {node.note}
        </pre>
      )}

      {node.inputs.length > 0 ? (
        <div className="space-y-1">
          {node.inputs.map((inputEntry, inputIndex) => (
            <div
              key={`${node.id}:${inputEntry.name}:${inputIndex}`}
              className="rounded border border-ui-border bg-ui-bg px-2 py-1"
            >
              <p className="text-ui-xs font-medium text-ui-ink-secondary">
                {inputEntry.name}
                {inputEntry.type ? ` [${inputEntry.type}]` : ""}
              </p>
              <pre className="mt-0.5 whitespace-pre-wrap break-all text-ui-xs text-(--ui-ink-primary)">
                {inputEntry.value ?? "(link only)"}
              </pre>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-ui-xs text-ui-ink-subtle">No inputs.</p>
      )}
    </div>
  );
}

export default function WorkflowSidePanel({ workflow, workflowDetails }: WorkflowSidePanelProps) {
  const activeNode = workflow.selectedWorkflowNode ?? workflow.filteredWorkflowNodes[0] ?? null;

  return (
    <aside
      className="flex shrink-0 flex-col rounded-xl border border-ui-border bg-(--ui-bg)/80 p-3"
      style={{ width: `${workflow.workflowPanelWidth}px` }}
    >
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Workflow Nodes</SectionLabel>
        <span className="text-ui-xs text-ui-ink-subtle">
          {workflow.filteredWorkflowNodes.length}/{workflowDetails.nodes.length}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1">
        <OutlineButton
          type="button"
          onClick={() => workflow.setWorkflowScale((current) => Math.min(1.8, current * 1.12))}
          className="rounded border border-ui-border-strong bg-ui-bg px-2 py-1 text-ui-xs text-ui-ink-secondary transition hover:bg-ui-bg-soft"
          title="Zoom in"
        >
          +
        </OutlineButton>
        <OutlineButton
          type="button"
          onClick={() => workflow.setWorkflowScale((current) => Math.max(0.2, current * 0.9))}
          className="rounded border border-ui-border-strong bg-ui-bg px-2 py-1 text-ui-xs text-ui-ink-secondary transition hover:bg-ui-bg-soft"
          title="Zoom out"
        >
          -
        </OutlineButton>
        <OutlineButton
          type="button"
          onClick={() => workflow.fitWorkflowToViewport()}
          className="rounded border border-ui-border-strong bg-ui-bg px-2 py-1 text-ui-xs text-ui-ink-secondary transition hover:bg-ui-bg-soft"
          title="Fit workflow"
        >
          Fit
        </OutlineButton>
        <span className="ml-auto text-ui-xs text-ui-ink-subtle">
          {(workflow.workflowScale * 100).toFixed(0)}%
        </span>
      </div>

      <div className="mt-2 grid gap-2">
        <TextInput
          controlSize="sm"
          value={workflow.workflowSearchTerm}
          onChange={(event) => workflow.setWorkflowSearchTerm(event.currentTarget.value)}
          placeholder="Search notes and node inputs..."
          className="w-full border-ui-border-strong bg-ui-bg text-(--ui-ink-primary) transition focus:border-ui-border-focus focus:ring-2 focus:ring-ui-ring-focus"
        />
        <SelectInput
          controlSize="sm"
          value={workflow.workflowNodeTypeFilter}
          onChange={(event) => workflow.setWorkflowNodeTypeFilter(event.currentTarget.value)}
          className="w-full border-ui-border-strong bg-ui-bg text-(--ui-ink-primary) transition focus:border-ui-border-focus focus:ring-2 focus:ring-ui-ring-focus"
        >
          <option value="all">All node types</option>
          {workflow.workflowNodeTypes.map((nodeType) => (
            <option key={nodeType} value={nodeType}>
              {nodeType}
            </option>
          ))}
        </SelectInput>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-ui-xs text-ui-ink-secondary">
        <InfoChip className="border border-ui-border-strong bg-ui-bg-soft px-2 py-0.5">
          Notes: {workflowDetails.noteNodeCount}
        </InfoChip>
        {workflowDetails.workflowId && (
          <InfoChip className="border border-ui-border-strong bg-ui-bg-soft px-2 py-0.5">
            Workflow ID: {workflowDetails.workflowId}
          </InfoChip>
        )}
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-ui-border bg-(--ui-bg-soft)/75 p-2">
        {activeNode ? (
          <NodeDetailView node={activeNode} />
        ) : (
          <p className="text-ui-xs text-ui-ink-subtle">
            No workflow nodes match your filters.
          </p>
        )}
      </div>
    </aside>
  );
}




