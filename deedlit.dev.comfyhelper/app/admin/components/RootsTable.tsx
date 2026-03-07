"use client";

import {
  EmptyState,
  OutlineButton,
  PanelSectionHeader,
  StatusBadge,
  SurfacePanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@deedlit.dev/ui";
import type { RootDirectory } from "@/lib/library-types";
import { toFriendlyDate } from "@/lib/format-utils";

type RootsTableProps = {
  isLoading: boolean;
  roots: RootDirectory[];
  busyAction: string | null;
  onToggleRootVisibility: (root: RootDirectory) => void;
  onRemoveRoot: (root: RootDirectory) => void;
};

export default function RootsTable({
  isLoading,
  roots,
  busyAction,
  onToggleRootVisibility,
  onRemoveRoot,
}: RootsTableProps) {
  if (isLoading) {
    return <EmptyState tone="subtle" className="mt-4">Loading configuration...</EmptyState>;
  }

  if (roots.length === 0) {
    return (
      <EmptyState className="mt-4">No roots configured yet.</EmptyState>
    );
  }

  return (
    <SurfacePanel
      id="roots-table-container"
      data-testid="roots-table-container"
      tone="soft"
      padding="none"
      className="mt-4"
    >
      <div className="border-b border-[color:var(--ui-border-faint)] px-3 py-2">
        <PanelSectionHeader title="Configured Roots" description="Structured view for visibility and actions." />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-t-0">
              <TableHead>Status</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roots.map((root) => (
              <TableRow
                key={root.id}
                data-testid={`root-row-${root.id}`}
              >
                <TableCell>
                  <StatusBadge tone={root.isVisible ? "success" : "neutral"} className="px-2 py-0.5">
                    {root.isVisible ? "Visible" : "Hidden"}
                  </StatusBadge>
                </TableCell>
                <TableCell className="max-w-[720px] break-all text-ui-sm text-[color:var(--ui-ink-table)]">
                  {root.path}
                </TableCell>
                <TableCell className="whitespace-nowrap text-[color:var(--ui-ink-subtle)]">
                  {toFriendlyDate(root.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <OutlineButton
                      data-testid={`toggle-root-visibility-${root.id}`}
                      onClick={() => onToggleRootVisibility(root)}
                      disabled={busyAction === `visibility:${root.id}`}
                      controlSize="xs"
                      className="px-3"
                    >
                      {busyAction === `visibility:${root.id}`
                        ? "Updating..."
                        : root.isVisible
                          ? "Hide"
                          : "Display"}
                    </OutlineButton>
                    <OutlineButton
                      data-testid={`remove-root-${root.id}`}
                      onClick={() => onRemoveRoot(root)}
                      disabled={busyAction === `remove:${root.id}`}
                      variant="danger"
                      controlSize="xs"
                      className="px-3"
                    >
                      {busyAction === `remove:${root.id}` ? "Removing..." : "Remove"}
                    </OutlineButton>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SurfacePanel>
  );
}





