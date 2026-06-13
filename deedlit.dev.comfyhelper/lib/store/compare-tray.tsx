"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const MAX = 4;
const STORAGE_KEY = "comfyhelper-compare-tray";

interface CompareTrayValue {
  ids: string[];
  has: (id: string) => boolean;
  add: (id: string) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
  isFull: boolean;
  max: number;
}

const CompareTrayContext = createContext<CompareTrayValue | null>(null);

/**
 * Holds the set of images queued for side-by-side comparison.  Persisted to
 * sessionStorage so the selection survives navigation between library pages.
 */
export function CompareTrayProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setIds(parsed.filter((x) => typeof x === "string").slice(0, MAX));
        }
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      // ignore quota / disabled storage
    }
  }, [ids]);

  const add = useCallback(
    (id: string) => setIds((p) => (p.includes(id) || p.length >= MAX ? p : [...p, id])),
    [],
  );
  const remove = useCallback((id: string) => setIds((p) => p.filter((x) => x !== id)), []);
  const toggle = useCallback(
    (id: string) =>
      setIds((p) =>
        p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id],
      ),
    [],
  );
  const clear = useCallback(() => setIds([]), []);

  const value = useMemo<CompareTrayValue>(
    () => ({
      ids,
      has: (id: string) => ids.includes(id),
      add,
      remove,
      toggle,
      clear,
      isFull: ids.length >= MAX,
      max: MAX,
    }),
    [ids, add, remove, toggle, clear],
  );

  return <CompareTrayContext.Provider value={value}>{children}</CompareTrayContext.Provider>;
}

export function useCompareTray(): CompareTrayValue {
  const ctx = useContext(CompareTrayContext);
  if (!ctx) throw new Error("useCompareTray must be used within CompareTrayProvider");
  return ctx;
}
