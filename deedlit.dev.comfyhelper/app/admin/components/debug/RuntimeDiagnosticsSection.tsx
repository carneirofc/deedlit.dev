import type { ScanJobInfo } from "@/lib/library-types";

import DebugSection from "./DebugSection";
import { DebugField, DebugFieldGrid, StatusText } from "./DebugField";

export type RuntimeDiagnosticsSectionProps = {
  isBrowserOnline: boolean | null;
  documentVisibility: string;
  isLoading: boolean;
  busyAction: string | null;
  scanJob: ScanJobInfo | null;
  scanWarningsCount: number;
  visibleRootCount: number;
  visibleCachedImages: number | null;
};

function onlineColor(value: boolean | null) {
  if (value === null) return "warning" as const;
  return value ? ("success" as const) : ("danger" as const);
}

function onlineLabel(value: boolean | null) {
  if (value === null) return "checking";
  return value ? "yes" : "no";
}

export default function RuntimeDiagnosticsSection({
  isBrowserOnline,
  documentVisibility,
  isLoading,
  busyAction,
  scanJob,
  scanWarningsCount,
  visibleRootCount,
  visibleCachedImages,
}: RuntimeDiagnosticsSectionProps) {
  return (
    <DebugSection title="Runtime Diagnostics">
      <DebugFieldGrid>
        <DebugField label="Browser online">
          <StatusText color={onlineColor(isBrowserOnline)}>{onlineLabel(isBrowserOnline)}</StatusText>
        </DebugField>
        <DebugField label="Document visibility">{documentVisibility}</DebugField>
        <DebugField label="Page load status">{isLoading ? "loading" : "loaded"}</DebugField>
        <DebugField label="Active action">{busyAction ?? "none"}</DebugField>
        <DebugField label="Current scan status">{scanJob?.status ?? "idle"}</DebugField>
        <DebugField label="Scan warnings">{scanWarningsCount}</DebugField>
        <DebugField label="Visible roots">{visibleRootCount}</DebugField>
        <DebugField label="Cached images (visible roots)">{visibleCachedImages ?? "unknown"}</DebugField>
      </DebugFieldGrid>
    </DebugSection>
  );
}
