"use client";

import { StatusBanner } from "@deedlit.dev/ui";
import type { WorkflowDetails } from "@/lib/gallery-types";
import type { WorkflowViewerState } from "../../hooks";
import WorkflowSidePanel from "./WorkflowSidePanel";
import WorkflowCanvas from "./WorkflowCanvas";

type WorkflowTabContentProps = {
  isLoading: boolean;
  error: string | null;
  workflowDetails: WorkflowDetails | null;
  workflow: WorkflowViewerState;
};

export default function WorkflowTabContent({ isLoading, error, workflowDetails, workflow }: WorkflowTabContentProps) {
  if (isLoading) {
    return <StatusBanner tone="loading">Loading workflow metadata...</StatusBanner>;
  }

  if (error) {
    return <StatusBanner tone="error">{error}</StatusBanner>;
  }

  if (!workflowDetails) {
    return (
      <p className="mt-2 text-ui-xs text-ui-ink-subtle">
        No embedded workflow metadata found for this image.
      </p>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 gap-2">
      {workflow.showWorkflowPanel && (
        <>
          <WorkflowSidePanel workflow={workflow} workflowDetails={workflowDetails} />

          <div className="relative w-2 shrink-0">
            <button
              type="button"
              aria-label="Resize workflow details panel"
              className="absolute inset-0 cursor-col-resize touch-none"
              onPointerDown={workflow.handleWorkflowPanelResizePointerDown}
              onPointerMove={workflow.handleWorkflowPanelResizePointerMove}
              onPointerUp={workflow.handleWorkflowPanelResizePointerUp}
              onLostPointerCapture={() => {
                // handled internally by workflowPanelResizeRef
              }}
            >
              <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 rounded bg-ui-divider transition hover:bg-ui-divider-hover" />
            </button>
          </div>
        </>
      )}

      <WorkflowCanvas workflow={workflow} />
    </section>
  );
}

