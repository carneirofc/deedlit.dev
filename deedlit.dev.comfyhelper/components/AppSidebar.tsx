"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";

type NavIconLinkProps = {
  href: string;
  label: string;
  isActive: boolean;
  icon: ReactNode;
  testId: string;
  onNavigate?: () => void;
};

type ExternalLinkProps = {
  href: string;
  label: string;
  icon: ReactNode;
};

function navItemClass(isActive: boolean): string {
  const baseClassName =
    "app-sidebar-nav-item relative grid h-11 w-11 place-items-center rounded-xl border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  if (isActive) {
    return `${baseClassName} app-sidebar-nav-item-active`;
  }

  return baseClassName;
}

function NavIconLink({
  href,
  label,
  isActive,
  icon,
  testId,
  onNavigate,
}: NavIconLinkProps) {
  return (
    <Link
      href={href}
      prefetch={false}
      id={`nav-link-${testId}`}
      data-testid={`nav-link-${testId}`}
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      className={`${navItemClass(isActive)} group`}
      onClick={() => {
        if (isActive) {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        onNavigate?.();
      }}
    >
      {icon}
      <span className="app-sidebar-nav-tooltip pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-90 hidden -translate-y-1/2 rounded-md border px-2 py-1 text-ui-xs font-medium whitespace-nowrap shadow-panel-sm md:group-hover:block md:group-focus-visible:block">
        {label}
      </span>
    </Link>
  );
}

function ExternalToolLink({ href, label, icon }: ExternalLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className="app-sidebar-nav-item group relative grid h-11 w-11 place-items-center rounded-xl border transition hover:border-accent-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {icon}
      <span className="app-sidebar-nav-tooltip pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-90 hidden -translate-y-1/2 rounded-md border px-2 py-1 text-ui-xs font-medium whitespace-nowrap shadow-panel-sm md:group-hover:block md:group-focus-visible:block">
        {label}
      </span>
    </a>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const [isMobileNavExpanded, setIsMobileNavExpanded] = useState(false);

  return (
    <aside
      id="app-sidebar"
      data-testid="app-sidebar"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-80 flex justify-center px-3 md:inset-x-auto md:bottom-auto md:left-4 md:top-1/2 md:-translate-y-1/2 md:px-0"
    >
      <div className="app-sidebar-shell pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl border p-2 shadow-panel-lg backdrop-blur-xl md:flex-col md:max-w-none">
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

        {/* Mobile toggle button */}
        <button
          type="button"
          onClick={() => setIsMobileNavExpanded(!isMobileNavExpanded)}
          aria-label={isMobileNavExpanded ? "Collapse navigation" : "Expand navigation"}
          aria-expanded={isMobileNavExpanded}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-ui-ink-muted transition hover:bg-ui-bg-soft hover:text-ui-ink-title md:hidden"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {isMobileNavExpanded ? (
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

        <nav
          id="primary-navigation"
          data-testid="primary-navigation"
          className={`flex items-center gap-2 transition-all md:flex-col md:overflow-visible md:shrink-0 ${
            isMobileNavExpanded
              ? "flex-1 min-w-0 overflow-x-auto opacity-100"
              : "max-w-0 overflow-hidden opacity-0 md:max-w-none md:opacity-100"
          }`}
          aria-label="Primary navigation"
        >
          <NavIconLink
            href="/library"
            label="Image Library"
            isActive={
              (pathname === "/library" || pathname.startsWith("/library/")) &&
              !pathname.startsWith("/library/settings")
            }
            testId="library"
            onNavigate={() => setIsMobileNavExpanded(false)}
            icon={
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-none stroke-current"
                strokeWidth="1.8"
              >
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                <circle cx="11" cy="9" r="1.4" />
                <path d="M20 14l-4-3.5L9 17" />
              </svg>
            }
          />
          <NavIconLink
            href="/ui"
            label="UI Showcase"
            isActive={pathname.startsWith("/ui")}
            testId="ui-showcase"
            onNavigate={() => setIsMobileNavExpanded(false)}
            icon={
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-none stroke-current"
                strokeWidth="1.8"
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18" />
                <path d="M8 4v16" />
              </svg>
            }
          />

          <NavIconLink
            href="/admin"
            label="Backend Admin"
            isActive={pathname.startsWith("/admin")}
            testId="admin"
            onNavigate={() => setIsMobileNavExpanded(false)}
            icon={
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-none stroke-current"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2 4 5v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5l-8-3z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            }
          />

          <NavIconLink
            href="/library/settings"
            label="Settings"
            isActive={pathname.startsWith("/library/settings")}
            testId="settings"
            onNavigate={() => setIsMobileNavExpanded(false)}
            icon={
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-none stroke-current"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            }
          />

          {/* Divider */}
          <div className="mx-1 h-px w-7 bg-ui-border/60 md:h-7 md:w-px" aria-hidden="true" />

          {/* External tool links */}
          <ExternalToolLink
            href="http://localhost:8000"
            label="deedlit.vision — CLIP embedding API"
            icon={
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V12" />
                <path d="M8 6a4 4 0 0 1 4-4" />
                <circle cx="12" cy="16" r="4" />
                <path d="M12 12v2" />
                <path d="M9.5 17.5 8 19" />
                <path d="M14.5 17.5 16 19" />
              </svg>
            }
          />
          <ExternalToolLink
            href="http://localhost:8188"
            label="ComfyUI"
            icon={
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M14 17.5h7M17.5 14v7" />
              </svg>
            }
          />
          <ExternalToolLink
            href="http://localhost:7474"
            label="Neo4j Browser"
            icon={
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="2" />
                <circle cx="5" cy="19" r="2" />
                <circle cx="19" cy="19" r="2" />
                <path d="M12 7v4M7 18l4-5M17 18l-4-5" />
              </svg>
            }
          />
          <ExternalToolLink
            href="http://localhost:6333/dashboard"
            label="Qdrant Dashboard"
            icon={
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="1.5" />
                <circle cx="18" cy="6" r="1.5" />
                <circle cx="6" cy="18" r="1.5" />
                <circle cx="18" cy="18" r="1.5" />
                <circle cx="12" cy="12" r="2" />
                <path d="M7.5 6h4.5M12 6v4.5M6 7.5v4.5M7.5 18h4.5M12 18v-4.5M18 7.5v4.5M16.5 6h-4.5" />
              </svg>
            }
          />
          <ExternalToolLink
            href="http://localhost:9001"
            label="RustFS Console"
            icon={
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
                <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
              </svg>
            }
          />
        </nav>
      </div>
    </aside>
  );
}
