"use client";

import { useEffect, useState } from "react";

import { isImageFile } from "@/lib/library/paths";

/**
 * Live validation/preview for an ingestion-source path. Debounces the typed
 * path and lists it through the `/api/library/fs/browse` proxy (which reaches
 * the ingest host's filesystem). Surfaces whether the path is a real directory
 * and how many images / sub-folders sit directly inside it — so a bad path is
 * caught before "Start"/"Add" instead of failing the dispatched job.
 *
 * The image/sub-folder counts are for THIS folder only (the listing is one
 * level deep); a recursive scan will find more. Labelled as such in the UI.
 */

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export type PathPreview =
  | { state: "idle" }
  | { state: "checking" }
  | {
      state: "valid";
      /** Absolute path as resolved by the ingest host. */
      resolvedPath: string;
      /** Image files directly in this folder (non-recursive). */
      imageCount: number;
      /** Sub-folders directly in this folder. */
      subdirCount: number;
    }
  | { state: "invalid"; error: string };

export function usePathPreview(
  path: string,
  opts: { enabled?: boolean; debounceMs?: number } = {},
): PathPreview {
  const { enabled = true, debounceMs = 400 } = opts;
  const [preview, setPreview] = useState<PathPreview>({ state: "idle" });

  useEffect(() => {
    const trimmed = path.trim();
    // Nothing to check — leave the last result in state; the consumer hides it
    // for an empty field. (Setting state synchronously here would cascade.)
    if (!enabled || !trimmed) return;

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreview({ state: "checking" });
      try {
        const res = await fetch(`/api/library/fs/browse?path=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setPreview({ state: "invalid", error: json.error ?? "Cannot read this folder." });
          return;
        }
        const entries: FsEntry[] = Array.isArray(json.entries) ? json.entries : [];
        setPreview({
          state: "valid",
          resolvedPath: typeof json.path === "string" ? json.path : trimmed,
          imageCount: entries.filter((e) => !e.isDirectory && isImageFile(e.name)).length,
          subdirCount: entries.filter((e) => e.isDirectory).length,
        });
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setPreview({ state: "invalid", error: "Filesystem service unreachable." });
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, enabled, debounceMs]);

  return preview;
}
