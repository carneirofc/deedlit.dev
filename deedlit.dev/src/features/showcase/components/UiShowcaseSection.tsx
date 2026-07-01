"use client";

import Image from "next/image";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";

import {
  CyberSubpanel,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FilterSelectionCard,
  InfoChip,
  OutlineButton,
  PanelSectionHeader,
  ScanProgress,
  SectionLabel,
  SegmentedControl,
  SelectInput,
  StatusBadge,
  StatusMessage,
  SurfacePanel,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TextAreaInput,
  TextInput,
  Toast,
  WarningList,
} from "@carneirofc/ui";
import { toggleStringInList } from "@/lib/list-utils";

const INITIAL_POSITIVE_FILTERS = ["masterpiece", "cinematic lighting", "depth of field"];
const INITIAL_NEGATIVE_FILTERS = ["lowres", "watermark"];
const INITIAL_MODEL_FILTERS = ["ponyXL", "sdxl-lightning"];
const TABLE_EXAMPLE_ROWS = [
  { id: "queue-A", stage: "Queued", owner: "Gallery worker", startedAt: "09:04", duration: "n/a" },
  { id: "queue-B", stage: "Scanning", owner: "Indexer #2", startedAt: "09:06", duration: "01:42" },
  { id: "queue-C", stage: "Complete", owner: "Indexer #1", startedAt: "08:59", duration: "02:11" },
];

type DockTab = "tag-filter-panel" | "path-tree-filter" | "tag-preset-panel";

export function UiShowcaseSection() {
  const [logicalMode, setLogicalMode] = useState<"and" | "or">("and");
  const [dockTab, setDockTab] = useState<DockTab>("tag-filter-panel");
  const [scanProgress, setScanProgress] = useState(42);
  const [searchPrompt, setSearchPrompt] = useState("cinematic portrait, rim lighting");
  const [rootScope, setRootScope] = useState("all-roots");
  const [scanNotes, setScanNotes] = useState("Skip temp outputs and archive folders.");
  const [positiveFilters, setPositiveFilters] = useState<string[]>(INITIAL_POSITIVE_FILTERS);
  const [negativeFilters, setNegativeFilters] = useState<string[]>(INITIAL_NEGATIVE_FILTERS);
  const [modelFilters, setModelFilters] = useState<string[]>(INITIAL_MODEL_FILTERS);
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [toastCycle, setToastCycle] = useState(0);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);

  const warnings = useMemo(
    () => [
      "demo warning: metadata parser skipped 3 malformed sidecar files",
      "demo warning: one root directory is currently offline",
    ],
    [],
  );

  const totalSelectedFilters = positiveFilters.length + negativeFilters.length + modelFilters.length;

  useEffect(() => {
    if (!isToastVisible) return;

    const timeoutId = window.setTimeout(() => {
      setIsToastVisible(false);
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [isToastVisible, toastCycle]);

  function removeFilter(setter: Dispatch<SetStateAction<string[]>>, target: string) {
    setter((current) => toggleStringInList(current, target));
  }

  function resetFilters() {
    setPositiveFilters(INITIAL_POSITIVE_FILTERS);
    setNegativeFilters(INITIAL_NEGATIVE_FILTERS);
    setModelFilters(INITIAL_MODEL_FILTERS);
  }

  function triggerToast() {
    setToastCycle((current) => current + 1);
    setIsToastVisible(true);
  }

  return (
    <section
      data-testid="ui-showcase-section"
      className="section-anchor mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6 lg:px-8"
    >
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel>Design System</SectionLabel>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">UI Component Showcase</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            Reusable UI components from the shared design system, currently used across Services, Gallery, and Books.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InfoChip>Components: 19</InfoChip>
          <InfoChip>Active filters: {totalSelectedFilters}</InfoChip>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <CyberSubpanel>
          <PanelSectionHeader
            title="Buttons And Chips"
            description="Outline button variants and info chips used across pages."
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <OutlineButton className="rounded-lg px-3 py-1.5 text-ui-xs">Neutral</OutlineButton>
            <OutlineButton variant="ghost" className="rounded-lg px-3 py-1.5 text-ui-xs">
              Ghost
            </OutlineButton>
            <OutlineButton variant="danger" className="rounded-lg px-3 py-1.5 text-ui-xs">
              Danger
            </OutlineButton>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <InfoChip>Visible roots: 5</InfoChip>
            <InfoChip>Gallery cols: 7</InfoChip>
            <InfoChip>Excluded tags: 12</InfoChip>
          </div>
        </CyberSubpanel>

        <CyberSubpanel>
          <PanelSectionHeader
            title="Status And Warnings"
            description="Reusable feedback components for info, success, warning, and errors."
          />
          <div className="mt-3 space-y-2">
            <StatusMessage role="status" tone="info">
              Connecting to statistics stream...
            </StatusMessage>
            <StatusMessage role="status" tone="success">
              Scan completed successfully.
            </StatusMessage>
            <StatusMessage role="alert" tone="warn">
              Scan finished with warnings.
            </StatusMessage>
            <StatusMessage role="alert" tone="error">
              Failed to load root directories.
            </StatusMessage>
            <WarningList warnings={warnings} />
          </div>
        </CyberSubpanel>

        <CyberSubpanel>
          <PanelSectionHeader
            title="Segmented Controls"
            description="Shared segmented control extracted from Gallery logic mode and filter dock tabs."
          />
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                value={logicalMode}
                onValueChange={setLogicalMode}
                options={[
                  { value: "and", label: "AND" },
                  { value: "or", label: "OR" },
                ]}
              />
              <InfoChip>Tag mode: {logicalMode.toUpperCase()}</InfoChip>
            </div>

            <SegmentedControl
              value={dockTab}
              onValueChange={setDockTab}
              className="grid w-full grid-cols-3 rounded-xl border border-(--ui-border-soft) bg-panel/70 p-1"
              optionClassName="rounded-lg px-2 py-1 text-ui-xs"
              options={[
                { value: "tag-filter-panel", label: "Tags" },
                { value: "path-tree-filter", label: "Path Tree" },
                { value: "tag-preset-panel", label: "Presets" },
              ]}
            />
          </div>
        </CyberSubpanel>

        <CyberSubpanel>
          <PanelSectionHeader
            title="Form Inputs"
            description="Text, select, and text-area controls used for settings forms and filter configuration."
          />
          <div className="mt-3 grid grid-cols-1 gap-3">
            <label className="grid gap-1 text-ui-xs text-[color:var(--ui-ink-subtle)]">
              Prompt Search
              <TextInput
                value={searchPrompt}
                onChange={(event) => setSearchPrompt(event.currentTarget.value)}
                placeholder="Search tags or prompt fragments"
              />
            </label>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-ui-xs text-[color:var(--ui-ink-subtle)]">
                Root Scope
                <SelectInput value={rootScope} onChange={(event) => setRootScope(event.currentTarget.value)}>
                  <option value="all-roots">All roots</option>
                  <option value="favorites">Favorites only</option>
                  <option value="recent">Recently updated roots</option>
                </SelectInput>
              </label>
              <label className="grid gap-1 text-ui-xs text-[color:var(--ui-ink-subtle)]">
                Compact Size Sample
                <TextInput controlSize="sm" defaultValue="sm size control" />
              </label>
            </div>
            <label className="grid gap-1 text-ui-xs text-[color:var(--ui-ink-subtle)]">
              Scan Notes
              <TextAreaInput
                rows={3}
                value={scanNotes}
                onChange={(event) => setScanNotes(event.currentTarget.value)}
                placeholder="Add scan notes for operators"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <InfoChip>Prompt chars: {searchPrompt.length}</InfoChip>
              <InfoChip>Notes chars: {scanNotes.length}</InfoChip>
              <InfoChip>Scope: {rootScope}</InfoChip>
            </div>
          </div>
        </CyberSubpanel>

        <CyberSubpanel>
          <PanelSectionHeader
            title="Scan Progress"
            description="Shared progress surface used while scanning roots in Gallery/Admin."
            actions={
              <div className="flex items-center gap-2">
                <OutlineButton
                  className="rounded-md px-2 py-1 text-ui-xs"
                  onClick={() => setScanProgress((current) => Math.max(0, current - 10))}
                >
                  -10%
                </OutlineButton>
                <OutlineButton
                  className="rounded-md px-2 py-1 text-ui-xs"
                  onClick={() => setScanProgress((current) => Math.min(100, current + 10))}
                >
                  +10%
                </OutlineButton>
              </div>
            }
          />
          <ScanProgress
            className="mt-3"
            title="Demo background scan"
            rootCount={5}
            progressPercent={scanProgress}
            processedCount={Math.floor((scanProgress / 100) * 920)}
            totalCount={920}
            statusLabel={scanProgress >= 100 ? "complete" : "running"}
          />
        </CyberSubpanel>

        <CyberSubpanel>
          <PanelSectionHeader
            title="Surface Panels And Badges"
            description="Tone variants for grouped surfaces with status badges for compact state display."
          />
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            <SurfacePanel tone="default" padding="sm" className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-ui-xs font-medium text-[color:var(--ui-ink-title)]">Default tone</span>
                <StatusBadge tone="neutral">Idle</StatusBadge>
              </div>
              <p className="text-ui-2xs text-[color:var(--ui-ink-subtle)]">Baseline panel for primary controls.</p>
            </SurfacePanel>
            <SurfacePanel tone="soft" padding="sm" className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-ui-xs font-medium text-[color:var(--ui-ink-title)]">Soft tone</span>
                <StatusBadge tone="success">Healthy</StatusBadge>
              </div>
              <p className="text-ui-2xs text-[color:var(--ui-ink-subtle)]">Good for secondary grouped metadata.</p>
            </SurfacePanel>
            <SurfacePanel tone="subtle" padding="sm" className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-ui-xs font-medium text-[color:var(--ui-ink-title)]">Subtle tone</span>
                <StatusBadge tone="warn">Attention</StatusBadge>
              </div>
              <p className="text-ui-2xs text-[color:var(--ui-ink-subtle)]">Useful for less prominent utility rows.</p>
            </SurfacePanel>
            <SurfacePanel tone="strong" padding="sm" className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-ui-xs font-medium text-[color:var(--ui-ink-title)]">Strong tone</span>
                <StatusBadge tone="error">Blocked</StatusBadge>
              </div>
              <p className="text-ui-2xs text-[color:var(--ui-ink-subtle)]">Useful for highlighted warning states.</p>
            </SurfacePanel>
          </div>
        </CyberSubpanel>

        <CyberSubpanel>
          <PanelSectionHeader
            title="Modal Components"
            description="Overlay examples for transient toast notifications and a focused image viewer."
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <OutlineButton className="rounded-lg px-3 py-1.5 text-ui-xs" onClick={triggerToast}>
              Trigger Toast
            </OutlineButton>
            <OutlineButton
              className="rounded-lg px-3 py-1.5 text-ui-xs"
              onClick={() => setIsImageViewerOpen(true)}
            >
              Open Image Viewer
            </OutlineButton>
            <InfoChip>Toast: {isToastVisible ? "visible" : "hidden"}</InfoChip>
            <InfoChip>Viewer: {isImageViewerOpen ? "open" : "closed"}</InfoChip>
          </div>
        </CyberSubpanel>

        <CyberSubpanel>
          <PanelSectionHeader
            title="Table Components"
            description="Reusable table primitives used across Admin and diagnostic views."
          />
          <div className="mt-3 overflow-x-auto rounded-lg border border-[color:var(--ui-border-subtle)] bg-[color:var(--ui-bg-alt)]">
            <Table>
              <TableCaption>Worker queue snapshot from the latest scan cycle.</TableCaption>
              <TableHeader>
                <TableRow className="border-t-0">
                  <TableHead>Job</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TABLE_EXAMPLE_ROWS.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-[color:var(--ui-ink-title)]">{row.id}</TableCell>
                    <TableCell>{row.stage}</TableCell>
                    <TableCell>{row.owner}</TableCell>
                    <TableCell className="whitespace-nowrap text-[color:var(--ui-ink-meta)]">{row.startedAt}</TableCell>
                    <TableCell className="text-right text-[color:var(--ui-ink-meta)]">{row.duration}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="font-medium text-[color:var(--ui-ink-muted)]">
                    Active workers: 2
                  </TableCell>
                  <TableCell className="text-right text-[color:var(--ui-ink-muted)]">Avg 01:56</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CyberSubpanel>
      </div>

      <CyberSubpanel className="mt-4">
        <PanelSectionHeader
          title="Filter Selection Cards"
          description="Reusable removable-chip groups extracted from Gallery active filter panels."
          actions={
            <OutlineButton className="rounded-md px-2 py-1 text-ui-xs" onClick={resetFilters}>
              Reset sample filters
            </OutlineButton>
          }
        />
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          <FilterSelectionCard
            title="Positive Tags"
            items={positiveFilters}
            onRemoveItem={(tag) => removeFilter(setPositiveFilters, tag)}
            removeTitlePrefix="Remove positive tag"
          />
          <FilterSelectionCard
            title="Negative Tags"
            items={negativeFilters}
            onRemoveItem={(tag) => removeFilter(setNegativeFilters, tag)}
            removeTitlePrefix="Remove negative tag"
          />
          <FilterSelectionCard
            title="Model Tags"
            items={modelFilters}
            onRemoveItem={(tag) => removeFilter(setModelFilters, tag)}
            removeTitlePrefix="Remove model tag"
          />
        </div>
      </CyberSubpanel>

      <Toast
        open={isToastVisible}
        onClose={() => setIsToastVisible(false)}
        title="Toast: Queue Synced"
        description="24 images were indexed and are now available in the gallery."
      />

      <Dialog
        open={isImageViewerOpen}
        onOpenChange={setIsImageViewerOpen}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Image Viewer</DialogTitle>
            <DialogDescription>Demo preview modal used for focused media inspection.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="relative aspect-[16/9] overflow-hidden rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-bg-tint)]">
              <Image
                src="/globe.svg"
                alt="Sample image viewer preview"
                fill
                sizes="(min-width: 1024px) 860px, 96vw"
                className="object-contain p-6"
              />
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </section>
  );
}
