import { toFriendlyDate, toFriendlySize } from "@/lib/format-utils";

import DebugSection from "./DebugSection";
import { DebugField, DebugFieldGrid } from "./DebugField";

export type SystemSnapshotSectionProps = {
  sqliteRelativePath: string | null;
  sqliteFileSizeBytes: number | null;
  databaseRows: { rootDirectories: number; appSettings: number; imageCache: number; scanJobs: number } | null;
  scannedAt: string | null;
  userAgent: string;
};

export default function SystemSnapshotSection({
  sqliteRelativePath,
  sqliteFileSizeBytes,
  databaseRows,
  scannedAt,
  userAgent,
}: SystemSnapshotSectionProps) {
  return (
    <DebugSection title="System Snapshot">
      <DebugFieldGrid columns={1}>
        <DebugField label="SQLite path">{sqliteRelativePath ?? "unknown"}</DebugField>
        <DebugField label="SQLite size">{toFriendlySize(sqliteFileSizeBytes)}</DebugField>
        <p>
          DB rows: roots={databaseRows?.rootDirectories ?? "?"}, settings={databaseRows?.appSettings ?? "?"}, cache=
          {databaseRows?.imageCache ?? "?"}, scans={databaseRows?.scanJobs ?? "?"}
        </p>
        <DebugField label="Last completed scan">{scannedAt ? toFriendlyDate(scannedAt) : "never"}</DebugField>
        <p className="break-all">User agent: {userAgent}</p>
      </DebugFieldGrid>
    </DebugSection>
  );
}
