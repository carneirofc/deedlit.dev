import Link from "next/link";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Manage hub — one landing page for every control/management surface, collapsed
// behind a single "Manage" rail icon so the sidebar stays uncluttered. Each card
// deep-links to the dedicated page that owns that concern.
// ---------------------------------------------------------------------------

interface ManageDestination {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  testId: string;
}

const iconCls = "h-6 w-6 shrink-0 fill-none stroke-accent-cyan";

const DESTINATIONS: ManageDestination[] = [
  {
    href: "/admin",
    title: "Backend Admin",
    description: "Ingest folders, run maintenance, find & clean up missing files, and monitor jobs.",
    testId: "admin",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={iconCls} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 4 5v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5l-8-3z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    href: "/admin/health",
    title: "System Health",
    description: "Live status, dependency readiness & activity for every backend service.",
    testId: "health",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={iconCls} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    href: "/admin/queues",
    title: "Queues",
    description: "RabbitMQ queue depths, consumers, and dead-letter requeue / purge.",
    testId: "queues",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={iconCls} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h16M4 12h16M4 17h10" />
        <circle cx="19" cy="17" r="2" />
      </svg>
    ),
  },
  {
    href: "/admin/db",
    title: "Database (power tools)",
    description: "Raw catalog records: browse, edit, re-index / re-label, and delete.",
    testId: "db",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={iconCls} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
      </svg>
    ),
  },
  {
    href: "/admin/cache",
    title: "Image Cache",
    description: "Redis hit rate, entry counts, TTLs & flush control for the thumbnail / original cache.",
    testId: "cache",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={iconCls} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    href: "/library/settings",
    title: "Settings",
    description: "Ingest & indexing knobs, label-agent toggles, and other app preferences.",
    testId: "settings",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={iconCls} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

export default function ManagePage() {
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6" data-testid="manage-page">
      <header>
        <h1 className="text-ui-2xl font-semibold text-ui-ink-title">Manage</h1>
        <p className="text-ui-sm text-ui-ink-muted">
          Control and maintain the backend — ingestion, health, queues, the catalog database, and cleanup.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DESTINATIONS.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            data-testid={`manage-link-${d.testId}`}
            className="flex flex-col gap-2 rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 p-4 transition hover:border-accent-cyan/60"
          >
            <span className="flex items-center gap-3">
              {d.icon}
              <span className="text-ui-sm font-semibold text-ui-ink-title">{d.title}</span>
            </span>
            <span className="text-ui-2xs text-ui-ink-muted">{d.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
