import { InfoChip, OutlineButton, PageHeader } from "@deedlit.dev/ui";
import type { PromptStatistics, TagMetric } from "@/lib/library-types";

function toPercent(part: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }

  return `${((part / total) * 100).toFixed(1)}%`;
}

function toTestId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function StatisticsList({
  title,
  items,
  testId,
}: {
  title: string;
  items: TagMetric[];
  testId: string;
}) {
  return (
    <div
      id={`${testId}-list`}
      data-testid={`${testId}-list`}
      className="rounded-2xl border border-[color:var(--ui-border-soft)] bg-panel/92 p-3 shadow-[var(--ui-shadow-card)]"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="ui-text-label-sm text-[color:var(--ui-ink-caption)]">{title}</p>
        <InfoChip className="shrink-0 px-1.5 py-0 text-ui-2xs text-[color:var(--ui-ink-faint)]">
          {items.length} items
        </InfoChip>
      </div>
      {items.length === 0 ? (
        <p data-testid={`${testId}-empty`} className="mt-3 text-ui-xs text-[color:var(--ui-ink-meta)]">
          No data yet.
        </p>
      ) : (
        <div data-testid={`${testId}-items`} className="mt-3 space-y-1.5">
          {items.slice(0, 12).map((item, index) => (
            <div
              key={`${title}:${item.label}`}
              data-testid={`${testId}-item-${index}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--ui-border-faint)] bg-[color:var(--ui-bg-card)] px-2.5 py-1.5"
            >
              <p className="truncate text-ui-xs text-[color:var(--ui-ink-title)]">{item.label}</p>
              <span
                data-testid={`${testId}-item-count-${index}`}
                className="cyber-chip rounded-full px-1.5 py-0.5 text-ui-2xs font-medium text-[color:var(--ui-ink-accent)]"
              >
                {item.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatisticsMetricCard({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string | number;
  hint?: string;
  testId: string;
}) {
  return (
    <div
      id={`metric-${testId}`}
      data-testid={`metric-${testId}`}
      className="rounded-xl border border-[color:var(--ui-border-soft)] bg-panel/92 px-3 py-3 shadow-[var(--ui-shadow-card)]"
    >
      <p className="ui-text-label text-[color:var(--ui-ink-faint)]">{label}</p>
      <p data-testid={`metric-${testId}-value`} className="mt-1.5 text-ui-md font-semibold text-[color:var(--ui-ink-title)]">
        {value}
      </p>
      {hint ? (
        <p data-testid={`metric-${testId}-hint`} className="mt-1 text-ui-xs text-[color:var(--ui-ink-meta)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function StatsHeader({
  lastUpdatedLabel,
  isRefreshing,
  isProcessing,
  onRefresh,
}: {
  lastUpdatedLabel: string;
  isRefreshing: boolean;
  isProcessing: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      <PageHeader
        testId="stats-header"
        subtitle="deedlit.dev // gallery metrics"
        title="Prompt Usage Metrics"
        description="Most used tags, common prompt values, and metadata coverage across your cached gallery."
        titleTag="h2"
        className="mb-5"
        pillsClassName="w-full flex-nowrap gap-1.5 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0"
        pills={
          <>
            <InfoChip id="stats-last-updated" testId="stats-last-updated" aria-live="polite" className="shrink-0">
              {lastUpdatedLabel}
            </InfoChip>
            <InfoChip className="shrink-0">
              {isProcessing ? "Stream active" : "Snapshot ready"}
            </InfoChip>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-[color:var(--ui-border-faint)] pb-4">
        <OutlineButton
          id="stats-refresh-button"
          data-testid="stats-refresh-button"
          onClick={onRefresh}
          disabled={isRefreshing}
          variant="ghost"
          className="min-h-10 rounded-xl px-4 py-2 text-ui-sm"
        >
          {isRefreshing ? "Refreshing..." : isProcessing ? "Processing..." : "Refresh metrics"}
        </OutlineButton>
      </div>
    </>
  );
}

export function StatsMetricGrid({ stats }: { stats: PromptStatistics }) {
  const topPositiveTag = stats.topPositiveTags[0] ?? null;
  const topNegativeTag = stats.topNegativeTags[0] ?? null;
  const topModel = stats.topModels[0] ?? null;
  const topSampler = stats.topSamplers[0] ?? null;

  return (
    <div id="stats-metric-grid" data-testid="stats-metric-grid" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatisticsMetricCard label="Total cached images" value={stats.totalImages} testId="total-cached-images" />
      <StatisticsMetricCard
        label="With positive prompt"
        value={stats.imagesWithPositivePrompt}
        hint={`${toPercent(stats.imagesWithPositivePrompt, stats.totalImages)} coverage`}
        testId="with-positive-prompt"
      />
      <StatisticsMetricCard
        label="With negative prompt"
        value={stats.imagesWithNegativePrompt}
        hint={`${toPercent(stats.imagesWithNegativePrompt, stats.totalImages)} coverage`}
        testId="with-negative-prompt"
      />
      <StatisticsMetricCard
        label="With model"
        value={stats.imagesWithModel}
        hint={`${toPercent(stats.imagesWithModel, stats.totalImages)} coverage`}
        testId="with-model"
      />
      <StatisticsMetricCard
        label="With sampler"
        value={stats.imagesWithSampler}
        hint={`${toPercent(stats.imagesWithSampler, stats.totalImages)} coverage`}
        testId="with-sampler"
      />
      <StatisticsMetricCard label="Unique positive tags" value={stats.uniquePositiveTags} testId="unique-positive-tags" />
      <StatisticsMetricCard label="Unique negative tags" value={stats.uniqueNegativeTags} testId="unique-negative-tags" />
      <StatisticsMetricCard
        label="Avg tags per image"
        value={`+${stats.avgPositiveTagsPerImage} / -${stats.avgNegativeTagsPerImage}`}
        testId="avg-tags-per-image"
      />
      <StatisticsMetricCard
        label="Most used positive tag"
        value={topPositiveTag?.label ?? "No data"}
        hint={topPositiveTag ? `${topPositiveTag.count} images` : undefined}
        testId="most-used-positive-tag"
      />
      <StatisticsMetricCard
        label="Most common negative tag"
        value={topNegativeTag?.label ?? "No data"}
        hint={topNegativeTag ? `${topNegativeTag.count} images` : undefined}
        testId="most-common-negative-tag"
      />
      <StatisticsMetricCard
        label="Most used model"
        value={topModel?.label ?? "No data"}
        hint={topModel ? `${topModel.count} images` : undefined}
        testId="most-used-model"
      />
      <StatisticsMetricCard
        label="Most common sampler"
        value={topSampler?.label ?? "No data"}
        hint={topSampler ? `${topSampler.count} images` : undefined}
        testId="most-common-sampler"
      />
    </div>
  );
}

export function StatsListGrid({ stats }: { stats: PromptStatistics }) {
  return (
    <div id="stats-list-grid" data-testid="stats-list-grid" className="mt-6 grid gap-3 xl:grid-cols-2">
      <StatisticsList
        title="Top Positive Tags"
        items={stats.topPositiveTags}
        testId={`stats-list-${toTestId("Top Positive Tags")}`}
      />
      <StatisticsList
        title="Top Negative Tags"
        items={stats.topNegativeTags}
        testId={`stats-list-${toTestId("Top Negative Tags")}`}
      />
      <StatisticsList
        title="Top Models"
        items={stats.topModels}
        testId={`stats-list-${toTestId("Top Models")}`}
      />
      <StatisticsList
        title="Top Samplers"
        items={stats.topSamplers}
        testId={`stats-list-${toTestId("Top Samplers")}`}
      />
    </div>
  );
}

export function StatsStreamingProgress({
  processedTotal,
}: {
  processedTotal: number;
}) {
  return (
    <div
      data-testid="stats-streaming-progress"
      role="status"
      aria-live="polite"
      className="mt-4 rounded-xl border border-[color:var(--ui-border-soft)] bg-panel/80 px-3 py-2.5 backdrop-blur"
    >
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--accent-cyan)] opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[color:var(--accent-cyan)]" />
        </span>
        <span className="text-ui-sm text-[color:var(--ui-ink-accent)]">
          Loading statistics&hellip;
          {processedTotal > 0 ? ` ${processedTotal.toLocaleString()} images` : ""}
        </span>
      </div>
    </div>
  );
}

