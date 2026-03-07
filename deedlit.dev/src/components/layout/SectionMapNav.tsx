"use client";

import { useEffect, useState } from "react";

interface SectionMapItem {
  href: string;
  label: string;
}

interface SectionMapNavProps {
  items: SectionMapItem[];
}

export function SectionMapNav({ items }: SectionMapNavProps) {
  const [activeSection, setActiveSection] = useState<string>("#top");

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

    items.forEach((item) => {
      const id = item.href.replace("#", "");
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [items]);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
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
    <aside
      aria-label="Section map"
      className="fixed right-6 top-1/2 z-40 hidden -translate-y-1/2 lg:block"
    >
      <nav className="rounded-2xl border border-line/60 bg-surface/95 px-3 py-4 shadow-lg backdrop-blur-md transition-all duration-300 hover:shadow-xl hover:border-line/80">
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                onClick={(e) => handleClick(e, item.href)}
                className={`focus-ring block rounded-lg px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  activeSection === item.href
                    ? "bg-accent text-white shadow-md scale-105"
                    : "text-muted hover:text-text hover:bg-base/70 hover:scale-[1.02]"
                }`}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
