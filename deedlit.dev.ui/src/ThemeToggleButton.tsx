"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Public types ─────────────────────────────────────────────────────
export type ThemeMode = "light" | "dark";

export interface ThemeToggleButtonProps {
  /** Read the persisted theme. Defaults to `localStorage.getItem("ui-theme")`. */
  readTheme?: () => ThemeMode | null;
  /** Persist the resolved theme. Defaults to `localStorage.setItem("ui-theme", theme)`. */
  writeTheme?: (theme: ThemeMode) => void;
  /** Extra class names appended to the button element. */
  className?: string;
}

// ── Internal helpers ─────────────────────────────────────────────────
type DragPosition = { x: number; y: number };

const STORAGE_KEY_POSITION = "theme-toggle-position";
const DRAG_THRESHOLD = 5;
const ICON_CLASS = "h-4 w-4 shrink-0 fill-none stroke-current";

function defaultReadTheme(): ThemeMode | null {
  try {
    const stored = window.localStorage.getItem("ui-theme");
    if (stored === "light" || stored === "dark") return stored;
    return null;
  } catch {
    return null;
  }
}

function defaultWriteTheme(theme: ThemeMode) {
  try {
    window.localStorage.setItem("ui-theme", theme);
  } catch {
    // best-effort
  }
}

function resolveInitialTheme(read?: () => ThemeMode | null): ThemeMode {
  if (typeof window === "undefined") return "light";

  try {
    const stored = (read ?? defaultReadTheme)();
    if (stored === "light" || stored === "dark") return stored;

    if (document.documentElement.getAttribute("data-theme") === "dark") return "dark";

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function loadSavedPosition(): DragPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POSITION);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DragPosition;
    if (typeof parsed.x === "number" && typeof parsed.y === "number") return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveDragPosition(pos: DragPosition) {
  try {
    localStorage.setItem(STORAGE_KEY_POSITION, JSON.stringify(pos));
  } catch {
    // best-effort
  }
}

function clampPosition(x: number, y: number): DragPosition {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const buttonSize = 40;
  return {
    x: Math.max(4, Math.min(x, viewportW - buttonSize - 4)),
    y: Math.max(4, Math.min(y, viewportH - buttonSize - 4)),
  };
}

// ── Component ────────────────────────────────────────────────────────
export default function ThemeToggleButton({
  readTheme,
  writeTheme,
  className,
}: ThemeToggleButtonProps) {
  const read = readTheme ?? defaultReadTheme;
  const write = writeTheme ?? defaultWriteTheme;

  const [theme, setTheme] = useState<ThemeMode>(() => resolveInitialTheme(read));
  const [position, setPosition] = useState<DragPosition | null>(null);
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const startRef = useRef({ mouseX: 0, mouseY: 0, elX: 0, elY: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Load saved position on mount
  useEffect(() => {
    const saved = loadSavedPosition();
    if (saved) setPosition(clampPosition(saved.x, saved.y));
  }, []);

  // Clamp on resize
  useEffect(() => {
    function handleResize() {
      setPosition((prev) => (prev ? clampPosition(prev.x, prev.y) : null));
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Apply + persist whenever theme changes
  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
      write(theme);
    } catch {
      document.documentElement.setAttribute("data-theme", "light");
    }
  }, [theme, write]);

  const toggleTheme = useCallback(() => {
    setTheme((cur) => (cur === "dark" ? "light" : "dark"));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    startRef.current = { mouseX: e.clientX, mouseY: e.clientY, elX: rect.left, elY: rect.top };
    isDraggingRef.current = false;
    didDragRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startRef.current.mouseX;
    const dy = e.clientY - startRef.current.mouseY;
    if (!isDraggingRef.current && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
    isDraggingRef.current = true;
    didDragRef.current = true;
    setPosition(clampPosition(startRef.current.elX + dx, startRef.current.elY + dy));
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setPosition((prev) => {
        if (prev) saveDragPosition(prev);
        return prev;
      });
    }
  }, []);

  const handleClick = useCallback(() => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    toggleTheme();
  }, [toggleTheme]);

  const isPositioned = !!position;

  const style: React.CSSProperties = isPositioned
    ? { left: position.x, top: position.y, right: "auto", transition: isDraggingRef.current ? "none" : undefined }
    : {};

  return (
    <button
      ref={buttonRef}
      type="button"
      id="theme-toggle-button"
      data-testid="theme-toggle-button"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      aria-label="Toggle theme"
      aria-pressed={theme === "dark"}
      className={[
        "theme-toggle-btn",
        isPositioned ? "" : "right-4 top-4 md:right-6 md:top-5",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      title="Toggle light/dark theme — drag to reposition"
      suppressHydrationWarning
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON_CLASS} strokeWidth="1.9">
        <path d="M21 12.8A8.9 8.9 0 1 1 11.2 3a7.3 7.3 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}
