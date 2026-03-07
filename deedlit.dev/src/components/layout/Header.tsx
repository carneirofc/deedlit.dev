"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const navLinks = [
  { href: "#top", label: "Home" },
  { href: "#services", label: "Services" },
  { href: "#gallery", label: "Gallery" },
  { href: "#books", label: "Books" },
  { href: "#contact", label: "Contact" }
];

type Theme = "light" | "dark";
const THEME_COOKIE = "deedlit-theme";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function readThemeCookie(): Theme | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )deedlit-theme=(dark|light)/);
  return match ? (match[1] as Theme) : null;
}

function writeThemeCookie(theme: Theme) {
  if (typeof document === "undefined") return;
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

interface HeaderProps {
  showMobileNav?: boolean;
}

export function Header({ showMobileNav = true }: HeaderProps) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [ready, setReady] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("#top");

  useEffect(() => {
    const stored = readThemeCookie();
    const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
    const resolved = (stored ?? preferred) as Theme;
    setTheme(resolved);
    applyTheme(resolved);
    setReady(true);
  }, []);

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

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    writeThemeCookie(next);
  };

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    const id = href.replace("#", "");
    const element = document.getElementById(id);
    
    if (element) {
      const offset = 100;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth"
      });
      
      setActiveSection(href);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-base/75 backdrop-blur transition-all duration-300">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <a 
          href="#top" 
          onClick={(e) => handleNavClick(e, "#top")}
          className="focus-ring rounded-md text-lg font-medium tracking-tight transition-all duration-300 hover:text-accent"
        >
          deedlit.dev
        </a>

        <nav aria-label="Primary" className="hidden gap-5 text-sm md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => handleNavClick(e, link.href)}
              className={`focus-ring rounded-md px-2 py-1 transition-all duration-300 ${
                activeSection === link.href
                  ? "text-accent font-semibold"
                  : "text-muted hover:text-text"
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <button
          type="button"
          className="focus-ring rounded-full border border-line/90 bg-surface/70 px-3 py-1.5 text-xs text-muted transition-all duration-300 hover:text-text hover:border-accent/50 disabled:opacity-60"
          onClick={toggleTheme}
          disabled={!ready}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
        </button>
      </div>

      {showMobileNav ? (
        <nav
          aria-label="Primary mobile"
          className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-3 text-sm md:hidden sm:px-6"
        >
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => handleNavClick(e, link.href)}
              className={`focus-ring whitespace-nowrap rounded-full border border-line/80 bg-surface/70 px-3 py-1 transition-all duration-300 ${
                activeSection === link.href
                  ? "text-accent border-accent/40 font-semibold"
                  : "text-muted hover:text-text"
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
