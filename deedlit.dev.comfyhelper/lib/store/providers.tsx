"use client";

import type { ReactNode } from "react";

import { CompareTrayProvider } from "@/lib/store/compare-tray";
import { SettingsProvider } from "@/lib/store/settings";

/**
 * App-wide client providers.  The legacy SQLite gallery used Jotai + React Query
 * + an SSE event hub here; the image-library UI uses plain fetch.  The compare
 * tray (images queued for side-by-side comparison) and the user settings store
 * live here so they are shared across every library page.
 */
export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <CompareTrayProvider>{children}</CompareTrayProvider>
    </SettingsProvider>
  );
}
