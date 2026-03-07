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
          href="/"
          prefetch={false}
          id="nav-home-link"
          data-testid="nav-home-link"
          aria-label="Go to gallery root"
          title="Go to gallery root"
          className="app-sidebar-home-link grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-ui-sm font-semibold tracking-[0.08em] transition focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={() => {
            // if we are at home, we scroll to the top
            if (pathname === "/") {
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
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
            href="/"
            label="Gallery"
            isActive={pathname === "/"}
            testId="gallery"
            onNavigate={() => setIsMobileNavExpanded(false)}
            icon={
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-none stroke-current"
                strokeWidth="1.8"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="1.6" />
                <path d="M21 16l-5.5-5.5L6 20" />
              </svg>
            }
          />
          <NavIconLink
            href="/stats"
            label="Statistics"
            isActive={pathname.startsWith("/stats")}
            testId="statistics"
            onNavigate={() => setIsMobileNavExpanded(false)}
            icon={
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-none stroke-current"
                strokeWidth="1.8"
              >
                <path d="M4 20V10" />
                <path d="M10 20V4" />
                <path d="M16 20v-7" />
                <path d="M22 20V8" />
              </svg>
            }
          />
          <NavIconLink
            href="/notes"
            label="Prompt Notes"
            isActive={pathname.startsWith("/notes")}
            testId="notes"
            onNavigate={() => setIsMobileNavExpanded(false)}
            icon={
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-none stroke-current"
                strokeWidth="1.8"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M16 13H8" />
                <path d="M16 17H8" />
                <path d="M10 9H8" />
              </svg>
            }
          />
          <NavIconLink
            href="/collections"
            label="Collections"
            isActive={pathname.startsWith("/collections")}
            testId="collections"
            onNavigate={() => setIsMobileNavExpanded(false)}
            icon={
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-none stroke-current"
                strokeWidth="1.8"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
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
            label="Admin"
            isActive={pathname.startsWith("/admin")}
            testId="admin"
            onNavigate={() => setIsMobileNavExpanded(false)}
            icon={
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-none stroke-current"
                strokeWidth="1.8"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.7 1.7 0 0 0-1.82-.33 1.7 1.7 0 0 0-1 1.56V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1-1.56 1.7 1.7 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.7 1.7 0 0 0 .33-1.82 1.7 1.7 0 0 0-1.56-1H3a2 2 0 0 1 0-4h.09a1.7 1.7 0 0 0 1.56-1 1.7 1.7 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.7 1.7 0 0 0 1.82.33h.03a1.7 1.7 0 0 0 .97-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 .99 1.56 1.7 1.7 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.7 1.7 0 0 0-.33 1.82v.03a1.7 1.7 0 0 0 1.55.97H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1z" />
              </svg>
            }
          />
        </nav>
      </div>
    </aside>
  );
}
