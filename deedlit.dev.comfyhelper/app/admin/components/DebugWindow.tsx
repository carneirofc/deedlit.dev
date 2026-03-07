"use client";

import { OutlineButton, PanelSectionHeader, StatusBadge, SurfacePanel } from "@deedlit.dev/ui";
import type { ScanJobInfo } from "@/lib/library-types";

import type { EndpointHealth } from "./admin-types";
import { SocketSseSection, ApiHealthSection, RuntimeDiagnosticsSection, SystemSnapshotSection } from "./debug";

type DatabaseInfo = {
  tableRows: { rootDirectories: number; appSettings: number; imageCache: number; scanJobs: number };
} | null;

type SqliteInfo = {
  relativePath: string;
  fileSizeBytes: number | null;
} | null;

type LibraryInfo = {
  visibleCachedImages: number;
} | null;

export type DebugWindowProps = {
  isAppHealthy: boolean | null;
  isHealthCheckRunning: boolean;
  onRunHealthChecks: () => void;
  healthChecks: EndpointHealth[];
  healthCheckedAt: string | null;
  healthyEndpointCount: number;
  failedEndpointCount: number;
  isBrowserOnline: boolean | null;
  documentVisibility: string;
  isLoading: boolean;
  busyAction: string | null;
  scanJob: ScanJobInfo | null;
  scanWarningsCount: number;
  visibleRootCount: number;
  libraryInfo: LibraryInfo;
  sqliteInfo: SqliteInfo;
  databaseInfo: DatabaseInfo;
  scannedAt: string | null;
  userAgent: string;
};

function OverallHealthBadge({ isAppHealthy }: { isAppHealthy: boolean | null }) {
  const tone = isAppHealthy === null ? "warn" : isAppHealthy ? "success" : "error";
  const label = isAppHealthy === null ? "Checking..." : isAppHealthy ? "Healthy" : "Degraded";

  return (
    <StatusBadge data-testid="debug-overall-health" tone={tone}>
      Overall: {label}
    </StatusBadge>
  );
}

export default function DebugWindow({
  isAppHealthy,
  isHealthCheckRunning,
  onRunHealthChecks,
  healthChecks,
  healthCheckedAt,
  healthyEndpointCount,
  failedEndpointCount,
  isBrowserOnline,
  documentVisibility,
  isLoading,
  busyAction,
  scanJob,
  scanWarningsCount,
  visibleRootCount,
  libraryInfo,
  sqliteInfo,
  databaseInfo,
  scannedAt,
  userAgent,
}: DebugWindowProps) {
  return (
    <SurfacePanel
      id="admin-debug-window"
      data-testid="admin-debug-window"
      tone="strong"
      className="mt-4"
    >
      <PanelSectionHeader
        title="Debug Window"
        description="Live diagnostics for socket connectivity, API health, and runtime state."
        actions={
          <>
            <OverallHealthBadge isAppHealthy={isAppHealthy} />
            <OutlineButton
              onClick={onRunHealthChecks}
              disabled={isHealthCheckRunning}
              data-testid="debug-run-health-checks-button"
              className="text-ui-2xs"
            >
              {isHealthCheckRunning ? "Checking..." : "Run checks"}
            </OutlineButton>
          </>
        }
      />

      <div className="flex flex-col gap-2">
        <SocketSseSection />

        <ApiHealthSection
          healthyEndpointCount={healthyEndpointCount}
          failedEndpointCount={failedEndpointCount}
          healthCheckedAt={healthCheckedAt}
          healthChecks={healthChecks}
        />

        <RuntimeDiagnosticsSection
          isBrowserOnline={isBrowserOnline}
          documentVisibility={documentVisibility}
          isLoading={isLoading}
          busyAction={busyAction}
          scanJob={scanJob}
          scanWarningsCount={scanWarningsCount}
          visibleRootCount={visibleRootCount}
          visibleCachedImages={libraryInfo?.visibleCachedImages ?? null}
        />

        <SystemSnapshotSection
          sqliteRelativePath={sqliteInfo?.relativePath ?? null}
          sqliteFileSizeBytes={sqliteInfo?.fileSizeBytes ?? null}
          databaseRows={databaseInfo?.tableRows ?? null}
          scannedAt={scannedAt}
          userAgent={userAgent}
        />
      </div>
    </SurfacePanel>
  );
}




