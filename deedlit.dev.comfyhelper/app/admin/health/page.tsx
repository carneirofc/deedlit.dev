"use client";

import { ServiceStatusBoard } from "@/components/ServiceStatusBoard";

// Grafana base URL for the trace deep-link (compose maps it to :3002). Mirrors
// the admin page so the focused health view can also jump to distributed traces.
const GRAFANA_URL = process.env.NEXT_PUBLIC_GRAFANA_URL ?? "http://localhost:3002";

/**
 * Dedicated system-health page. A focused, full-page view of every backend
 * component's status + dependency readiness + live activity, driven by the
 * self-polling {@link ServiceStatusBoard}. Reachable from its own sidebar icon
 * (the heartbeat) so health is a first-class destination, not buried in admin.
 */
export default function HealthPage() {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6" data-testid="health-page">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-ui-2xl font-semibold text-ui-ink-title">System Health</h1>
          <p className="text-ui-sm text-ui-ink-muted">
            Live status, dependency readiness &amp; activity across every backend service.
          </p>
        </div>
        <a
          href={GRAFANA_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-ui-border/70 bg-ui-bg-soft px-3 py-2 text-ui-sm font-medium transition hover:bg-accent-cyan/10"
          data-testid="grafana-link"
        >
          View traces in Grafana ↗
        </a>
      </header>

      <ServiceStatusBoard />
    </div>
  );
}
