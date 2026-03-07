"use client";

import {
  OutlineButton,
  PanelSectionHeader,
  ScanProgress,
  SurfacePanel,
  StatusMessage,
  WarningList,
} from "@deedlit.dev/ui";
import type { RootDirectory, ScanJobInfo } from "@/lib/library-types";
import { toFriendlyDate } from "@/lib/format-utils";

import type { DebugWindowProps } from "./DebugWindow";
import DebugWindow from "./DebugWindow";
import RootsTable from "./RootsTable";
import type { ScannedFilesPanelProps } from "./ScannedFilesPanel";
import ScannedFilesPanel from "./ScannedFilesPanel";

type ScanActionsPanelProps = {
  statusMessage: string | null;
  errorMessage: string | null;
  scanWarnings: string[];
  isLoading: boolean;
  roots: RootDirectory[];
  busyAction: string | null;
  onToggleRootVisibility: (root: RootDirectory) => void;
  onRemoveRoot: (root: RootDirectory) => void;
  scanImageCount: number;
  scanJob: ScanJobInfo | null;
  scannedAt: string | null;
  isScanActive: boolean;
  scanProgressPercent: number;
  onRefreshView: () => void;
  onRescan: () => void;
  visibleRootCount: number;
  debugProps: DebugWindowProps;
  scannedFilesProps: ScannedFilesPanelProps;
};

export default function ScanActionsPanel({
  statusMessage,
  errorMessage,
  scanWarnings,
  isLoading,
  roots,
  busyAction,
  onToggleRootVisibility,
  onRemoveRoot,
  scanImageCount,
  scanJob,
  scannedAt,
  isScanActive,
  scanProgressPercent,
  onRefreshView,
  onRescan,
  visibleRootCount,
  debugProps,
  scannedFilesProps,
}: ScanActionsPanelProps) {
  return (
    <section
      id="admin-scan-control-panel"
      data-testid="admin-scan-control-panel"
      className="cyber-panel min-w-0 rounded-[28px] p-4 sm:p-5 xl:p-6"
    >
      <h2 className="cyber-title text-ui-lg font-semibold">
        Scan Control & Roots
      </h2>

      {statusMessage && (
        <StatusMessage
          testId="admin-status-message"
          role="status"
          tone="success"
          className="mt-4"
        >
          {statusMessage}
        </StatusMessage>
      )}
      {errorMessage && (
        <StatusMessage
          testId="admin-error-message"
          role="alert"
          tone="error"
          className="mt-4"
        >
          {errorMessage}
        </StatusMessage>
      )}
      {scanWarnings.length > 0 && (
        <WarningList
          warnings={scanWarnings}
          testId="scan-warning-list"
          className="mt-4"
        />
      )}

      <RootsTable
        isLoading={isLoading}
        roots={roots}
        busyAction={busyAction}
        onToggleRootVisibility={onToggleRootVisibility}
        onRemoveRoot={onRemoveRoot}
      />

      <SurfacePanel className="mt-4" padding="lg">
        <PanelSectionHeader
          title="Scan Actions"
          description="Refresh the cache asynchronously and inspect recently indexed files."
          descriptionClassName="mt-1 text-ui-sm text-[color:var(--ui-ink-muted)]"
          actions={
            <>
              <OutlineButton
                onClick={onRefreshView}
                disabled={isLoading}
                id="admin-refresh-view-button"
                data-testid="admin-refresh-view-button"
              >
                Refresh view
              </OutlineButton>
              <OutlineButton
                onClick={onRescan}
                disabled={busyAction === "rescan" || isLoading || isScanActive}
                id="run-scan-button"
                data-testid="run-scan-button"
                variant="accent"
              >
                {busyAction === "rescan"
                  ? "Starting..."
                  : isScanActive
                    ? "Scan running..."
                    : "Run scan now"}
              </OutlineButton>
            </>
          }
        />

        <div
          id="scan-summary-cards"
          data-testid="scan-summary-cards"
          className="mt-3 grid gap-2 text-ui-sm text-[color:var(--admin-muted)] sm:grid-cols-3"
        >
          <SurfacePanel
            data-testid="scan-summary-cached-images"
            tone="soft"
            padding="none"
            className="rounded-lg px-3 py-2"
          >
            Cached images: {scanImageCount}
          </SurfacePanel>
          <SurfacePanel
            data-testid="scan-summary-status"
            tone="soft"
            padding="none"
            className="rounded-lg px-3 py-2"
          >
            Scan status: {scanJob?.status ?? "idle"}
          </SurfacePanel>
          <SurfacePanel
            data-testid="scan-summary-last-completed"
            tone="soft"
            padding="none"
            className="rounded-lg px-3 py-2"
          >
            {scannedAt
              ? `Last completed: ${toFriendlyDate(scannedAt)}`
              : "Last completed: never"}
          </SurfacePanel>
        </div>

        {isScanActive && (
          <ScanProgress
            rootCount={visibleRootCount}
            title={
              scanJob?.status === "queued"
                ? "Scan queued"
                : "Manual scan in progress"
            }
            progressPercent={scanProgressPercent}
            processedCount={scanJob?.processedFiles}
            totalCount={scanJob?.totalFiles}
            statusLabel={scanJob?.status ? `${scanJob.status} scan` : undefined}
            className="mt-3"
          />
        )}
      </SurfacePanel>
      <DebugWindow {...debugProps} />

      <ScannedFilesPanel {...scannedFilesProps} />
    </section>
  );
}

