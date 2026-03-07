"use client";

import { toFriendlyDate } from "@/lib/format-utils";
import { CyberPanel, StatusMessage } from "@deedlit.dev/ui";
import { useStreamingStats } from "@/lib/queries/use-stats";

import {
  StatsHeader,
  StatsListGrid,
  StatsMetricGrid,
  StatsStreamingProgress,
} from "@/app/stats/statistics-components";

export default function StatisticsPage() {
  const {
    stats,
    isStreaming,
    isComplete,
    isLoading,
    processedTotal,
    elapsedMs,
    error,
    refresh,
  } = useStreamingStats();

  const lastUpdatedLabel =
    isComplete && stats?.generatedAt
      ? `Updated: ${toFriendlyDate(stats.generatedAt)}`
      : isStreaming
        ? "Streaming..."
        : stats?.generatedAt
          ? `Updated: ${toFriendlyDate(stats.generatedAt)}`
          : "No stats yet";

  return (
    <CyberPanel
      id="stats-page"
      data-testid="stats-page"
      className="rounded-[28px] p-4 sm:p-5 xl:p-6"
    >
      <StatsHeader
        lastUpdatedLabel={lastUpdatedLabel}
        isRefreshing={isStreaming}
        isProcessing={isStreaming}
        onRefresh={refresh}
      />

      {isStreaming ? (
        <StatsStreamingProgress
          processedTotal={processedTotal}
        />
      ) : null}

      {error ? (
        <StatusMessage testId="stats-error" role="alert" tone="error" className="mt-4">
          {error}
        </StatusMessage>
      ) : null}

      {isLoading && !stats ? (
        <StatusMessage testId="stats-loading-state" role="status" tone="info" className="mt-4">
          Connecting to statistics stream...
        </StatusMessage>
      ) : !stats || stats.totalImages === 0 ? (
        isStreaming ? null : (
          <StatusMessage testId="stats-empty-state" role="status" tone="info" className="mt-4">
            No cached images available to compute statistics.
          </StatusMessage>
        )
      ) : (
        <>
          <StatsMetricGrid stats={stats} />
          <StatsListGrid stats={stats} />
        </>
      )}
    </CyberPanel>
  );
}

