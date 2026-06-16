"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  HiOutlineHome,
  HiOutlineComputerDesktop,
  HiOutlinePhoto,
  HiOutlineBookOpen,
  HiOutlineSwatch,
  HiOutlineEnvelope,
  HiOutlineBars3,
  HiOutlineXMark,
} from "react-icons/hi2";

const navLinks = [
  {
    href: "#top",
    label: "Home",
    icon: <HiOutlineHome aria-hidden="true" className="h-5 w-5" />,
  },
  {
    href: "#services",
    label: "Services",
    icon: <HiOutlineComputerDesktop aria-hidden="true" className="h-5 w-5" />,
  },
  {
    href: "#gallery",
    label: "Gallery",
    icon: <HiOutlinePhoto aria-hidden="true" className="h-5 w-5" />,
  },
  {
    href: "#books",
    label: "Books",
    icon: <HiOutlineBookOpen aria-hidden="true" className="h-5 w-5" />,
  },
  {
    href: "#ui",
    label: "UI Kit",
    icon: <HiOutlineSwatch aria-hidden="true" className="h-5 w-5" />,
  },
  {
    href: "#contact",
    label: "Contact",
    icon: <HiOutlineEnvelope aria-hidden="true" className="h-5 w-5" />,
  },
];

type NavIconLinkProps = {
  href: string;
  label: string;
  isActive: boolean;
  icon: ReactNode;
  onNavigate?: () => void;
};

function NavIconLink({ href, label, isActive, icon, onNavigate }: NavIconLinkProps) {
  const base =
    "app-sidebar-nav-item relative grid h-11 w-11 place-items-center rounded-xl border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  const active = isActive ? "app-sidebar-nav-item-active" : "";

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const id = href.replace("#", "");
    const el = document.getElementById(id);
    if (el) {
      const offset = 100;
      const pos = el.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: pos, behavior: "smooth" });
    }
    onNavigate?.();
  };

  return (
    <a
      href={href}
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      className={`${base} ${active} group`}
      onClick={handleClick}
    >
      {icon}
      <span className="app-sidebar-nav-tooltip pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-90 hidden -translate-y-1/2 rounded-md border px-2 py-1 text-ui-xs font-medium whitespace-nowrap shadow-panel-sm md:group-hover:block md:group-focus-visible:block">
        {label}
      </span>
    </a>
  );
}

export function AppSidebar() {
  const [activeSection, setActiveSection] = useState("#top");
  const [isMobileNavExpanded, setIsMobileNavExpanded] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(`#${entry.target.id}`);
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );

    navLinks.forEach((link) => {
      const id = link.href.replace("#", "");
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <aside
      id="app-sidebar"
      data-testid="app-sidebar"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-80 flex justify-center px-3 md:inset-x-auto md:bottom-auto md:left-4 md:top-1/2 md:-translate-y-1/2 md:px-0"
    >
      <div className="app-sidebar-shell pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl border p-2 shadow-panel-lg backdrop-blur-xl md:flex-col md:max-w-none">
        {/* Home logo link */}
        <a
          href="#top"
          aria-label="Go to top"
          title="Go to top"
          className="app-sidebar-home-link grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-ui-sm font-semibold tracking-[0.08em] transition focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          DL
        </a>

        {/* Mobile toggle button */}
        <button
          type="button"
          onClick={() => setIsMobileNavExpanded(!isMobileNavExpanded)}
          aria-label={isMobileNavExpanded ? "Collapse navigation" : "Expand navigation"}
          aria-expanded={isMobileNavExpanded}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-ui-ink-muted transition hover:bg-ui-bg-soft hover:text-ui-ink-title md:hidden"
        >
          {isMobileNavExpanded ? (
            <HiOutlineXMark aria-hidden="true" className="h-5 w-5" />
          ) : (
            <HiOutlineBars3 aria-hidden="true" className="h-5 w-5" />
          )}
        </button>

        <nav
          id="primary-navigation"
          data-testid="primary-navigation"
          className={`flex items-center gap-2 transition-all md:flex-col md:overflow-visible md:shrink-0 ${
            isMobileNavExpanded
              ? "flex-1 min-w-0 overflow-x-auto opacity-100"
              : "max-w-0 overflow-hidden opacity-0 md:max-w-none md:opacity-100"
          }`}
          aria-label="Section navigation"
        >
          {navLinks.map((link) => (
            <NavIconLink
              key={link.href}
              href={link.href}
              label={link.label}
              isActive={activeSection === link.href}
              icon={link.icon}
              onNavigate={() => setIsMobileNavExpanded(false)}
            />
          ))}
        </nav>
      </div>
    </aside>
  );
}
