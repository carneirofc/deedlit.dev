"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type NavItem = {
  href: string;
  label: string;
  testId: string;
  icon: ReactNode;
  /** Active when the current path matches. */
  match: (pathname: string) => boolean;
};

type ExternalItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

// ── Icon set ──────────────────────────────────────────────────────────
const icon = {
  library: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <circle cx="11" cy="9" r="1.4" />
      <path d="M20 14l-4-3.5L9 17" />
    </svg>
  ),
  admin: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 5v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5l-8-3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  manage: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="18" r="2" />
    </svg>
  ),
  health: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  queues: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M4 12h16M4 17h10" />
      <circle cx="19" cy="17" r="2" />
    </svg>
  ),
  db: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  ),
  cache: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
  settings: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  vision: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V12" />
      <path d="M8 6a4 4 0 0 1 4-4" />
      <circle cx="12" cy="16" r="4" />
      <path d="M12 12v2" />
      <path d="M9.5 17.5 8 19" />
      <path d="M14.5 17.5 16 19" />
    </svg>
  ),
  comfy: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 17.5h7M17.5 14v7" />
    </svg>
  ),
  neo4j: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M12 7v4M7 18l4-5M17 18l-4-5" />
    </svg>
  ),
  qdrant: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="1.5" />
      <circle cx="18" cy="6" r="1.5" />
      <circle cx="6" cy="18" r="1.5" />
      <circle cx="18" cy="18" r="1.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M7.5 6h4.5M12 6v4.5M6 7.5v4.5M7.5 18h4.5M12 18v-4.5M18 7.5v4.5M16.5 6h-4.5" />
    </svg>
  ),
  rustfs: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
    </svg>
  ),
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/library",
    label: "Image Library",
    testId: "library",
    icon: icon.library,
    match: (p) => (p === "/library" || p.startsWith("/library/")) && !p.startsWith("/library/settings"),
  },
  {
    href: "/manage",
    label: "Manage",
    testId: "manage",
    icon: icon.manage,
    // Stays active across every management surface (the hub + all /admin pages).
    match: (p) => p === "/manage" || p.startsWith("/admin"),
  },
  { href: "/library/settings", label: "Settings", testId: "settings", icon: icon.settings, match: (p) => p.startsWith("/library/settings") },
];

const EXTERNAL_ITEMS: ExternalItem[] = [
  { href: "http://localhost:8000", label: "deedlit.vision — CLIP embedding API", icon: icon.vision },
  { href: "http://localhost:8188", label: "ComfyUI", icon: icon.comfy },
  { href: "http://localhost:7474", label: "Neo4j Browser", icon: icon.neo4j },
  { href: "http://localhost:6333/dashboard", label: "Qdrant Dashboard", icon: icon.qdrant },
  { href: "http://localhost:9001", label: "RustFS Console", icon: icon.rustfs },
];

function navItemClass(isActive: boolean): string {
  const base =
    "app-sidebar-nav-item relative grid h-11 w-11 place-items-center rounded-xl border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  return isActive ? `${base} app-sidebar-nav-item-active` : base;
}

// ── Desktop rail (icon-only, hover tooltip) ───────────────────────────
function RailNavLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <Link
      href={item.href}
      prefetch={false}
      id={`nav-link-${item.testId}`}
      data-testid={`nav-link-${item.testId}`}
      aria-label={item.label}
      aria-current={isActive ? "page" : undefined}
      className={`${navItemClass(isActive)} group`}
      onClick={() => {
        if (isActive) window.scrollTo({ top: 0, behavior: "smooth" });
      }}
    >
      {item.icon}
      <span className="app-sidebar-nav-tooltip pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-90 hidden -translate-y-1/2 rounded-md border px-2 py-1 text-ui-xs font-medium whitespace-nowrap shadow-panel-sm md:group-hover:block md:group-focus-visible:block">
        {item.label}
      </span>
    </Link>
  );
}

function RailExternalLink({ item }: { item: ExternalItem }) {
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={item.label}
      title={item.label}
      className="app-sidebar-nav-item group relative grid h-11 w-11 place-items-center rounded-xl border transition hover:border-accent-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {item.icon}
      <span className="app-sidebar-nav-tooltip pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-90 hidden -translate-y-1/2 rounded-md border px-2 py-1 text-ui-xs font-medium whitespace-nowrap shadow-panel-sm md:group-hover:block md:group-focus-visible:block">
        {item.label}
      </span>
    </a>
  );
}

// ── Mobile sheet (icon + label, full-width tap targets) ───────────────
function SheetRow({
  href,
  label,
  iconNode,
  isActive,
  external,
  onNavigate,
}: {
  href: string;
  label: string;
  iconNode: ReactNode;
  isActive?: boolean;
  external?: boolean;
  onNavigate: () => void;
}) {
  const className = `app-sidebar-nav-item flex items-center gap-3 rounded-xl border px-3 py-2.5 text-ui-sm font-medium transition ${
    isActive ? "app-sidebar-nav-item-active" : ""
  }`;
  const inner = (
    <>
      <span className="grid h-6 w-6 shrink-0 place-items-center">{iconNode}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {external && (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-none stroke-current opacity-50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      )}
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={className} onClick={onNavigate}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} prefetch={false} aria-label={label} aria-current={isActive ? "page" : undefined} className={className} onClick={onNavigate}>
      {inner}
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Esc closes the mobile sheet.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <aside
      id="app-sidebar"
      data-testid="app-sidebar"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-80 flex justify-center px-3 md:inset-x-auto md:bottom-auto md:left-4 md:top-1/2 md:-translate-y-1/2 md:px-0"
    >
      {/* Tap-outside backdrop (mobile only) */}
      {menuOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
          className="pointer-events-auto fixed inset-0 -z-10 bg-ui-bg-deep/40 backdrop-blur-[2px] md:hidden"
        />
      )}

      <div className="app-sidebar-shell pointer-events-auto relative flex items-center gap-2 rounded-2xl border p-2 shadow-panel-lg backdrop-blur-xl md:flex-col">
        <Link
          href="/library"
          prefetch={false}
          id="nav-home-link"
          data-testid="nav-home-link"
          aria-label="Go to image library"
          title="Go to image library"
          className="app-sidebar-home-link grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-ui-sm font-semibold tracking-[0.08em] transition focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          DL
        </Link>

        {/* Mobile sheet trigger */}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav-sheet"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-ui-ink-muted transition hover:bg-ui-bg-soft hover:text-ui-ink-title md:hidden"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {menuOpen ? (
              <>
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </>
            ) : (
              <>
                <path d="M3 12h18" />
                <path d="M3 6h18" />
                <path d="M3 18h18" />
              </>
            )}
          </svg>
        </button>

        {/* Desktop vertical rail (icons only) */}
        <nav
          id="primary-navigation"
          data-testid="primary-navigation"
          aria-label="Primary navigation"
          className="hidden md:flex md:flex-col md:items-center md:gap-2"
        >
          {NAV_ITEMS.map((it) => (
            <RailNavLink key={it.testId} item={it} isActive={it.match(pathname)} />
          ))}
          <div className="mx-1 my-1 h-px w-7 bg-ui-border/60 md:h-px md:w-7" aria-hidden="true" />
          {EXTERNAL_ITEMS.map((it) => (
            <RailExternalLink key={it.href} item={it} />
          ))}
        </nav>

        {/* Mobile sheet — labeled rows in a popover above the bar */}
        {menuOpen && (
          <div
            id="mobile-nav-sheet"
            className="app-sidebar-shell absolute bottom-[calc(100%+0.75rem)] left-1/2 w-[min(92vw,22rem)] -translate-x-1/2 rounded-2xl border p-2 shadow-panel-lg backdrop-blur-xl md:hidden"
          >
            <p className="px-2 pb-1.5 pt-1 text-ui-2xs font-medium uppercase tracking-wide text-ui-ink-muted">
              Navigate
            </p>
            <div className="grid grid-cols-1 gap-1.5 min-[480px]:grid-cols-2">
              {NAV_ITEMS.map((it) => (
                <SheetRow
                  key={it.testId}
                  href={it.href}
                  label={it.label}
                  iconNode={it.icon}
                  isActive={it.match(pathname)}
                  onNavigate={() => setMenuOpen(false)}
                />
              ))}
            </div>
            <p className="px-2 pb-1.5 pt-3 text-ui-2xs font-medium uppercase tracking-wide text-ui-ink-muted">
              External tools
            </p>
            <div className="grid grid-cols-1 gap-1.5 min-[480px]:grid-cols-2">
              {EXTERNAL_ITEMS.map((it) => (
                <SheetRow
                  key={it.href}
                  href={it.href}
                  label={it.label}
                  iconNode={it.icon}
                  external
                  onNavigate={() => setMenuOpen(false)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
