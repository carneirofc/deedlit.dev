"use client";

import type { AppSettings } from "@/lib/library-types";
import { toFriendlyDate } from "@/lib/format-utils";
import { InfoChip, PageHeader } from "@deedlit.dev/ui";

type AdminHeaderProps = {
  visibleRootCount: number;
  hiddenRootCount: number;
  settings: AppSettings;
  scannedAt: string | null;
};

export default function AdminHeader({
  visibleRootCount,
  hiddenRootCount,
  settings,
  scannedAt,
}: AdminHeaderProps) {
  return (
    <div className="cyber-panel rounded-[30px] p-5 sm:p-7">
      <PageHeader
        testId="admin-header"
        subtitle="deedlit.dev // control room"
        title="Library Settings"
        description="Manage root directories, parsing exclusions, and run manual scans."
      />

      <div
        id="admin-summary-pills"
        data-testid="admin-summary-pills"
        className="cyber-muted mt-5 flex flex-wrap gap-3 text-ui-sm"
      >
        <InfoChip testId="summary-visible-roots">Visible roots: {visibleRootCount}</InfoChip>
        <InfoChip testId="summary-hidden-roots">Hidden roots: {hiddenRootCount}</InfoChip>
        <InfoChip testId="summary-gallery-columns">Gallery cols: {settings.galleryColumns}</InfoChip>
        <InfoChip testId="summary-excluded-tags">Stats/parsing exclusions: {settings.excludedTags.length}</InfoChip>
        <InfoChip testId="summary-last-scan">
          {scannedAt ? `Last completed scan: ${toFriendlyDate(scannedAt)}` : "No completed scan yet"}
        </InfoChip>
      </div>
    </div>
  );
}




