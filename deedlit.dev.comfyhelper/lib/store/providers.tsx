"use client";

import type { ReactNode } from "react";

import { ActivityDock } from "@/components/ActivityDock";
import { ActivityToasts } from "@/components/ActivityToasts";
import { ActivityProvider } from "@/lib/store/activity";
import { CompareTrayProvider } from "@/lib/store/compare-tray";
import { SettingsProvider } from "@/lib/store/settings";

/**
 * App-wide client providers.  The legacy SQLite gallery used Jotai + React Query
 * + an SSE event hub here; the image-library UI uses plain fetch.  The compare
 * tray (images queued for side-by-side comparison), the user settings store, and
 * the global backend-activity store live here so they are shared across every
 * page. The activity dock + toasts are mounted once so progress for any tracked
 * backend interaction is visible on every route.
 */
export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <ActivityProvider>
        <CompareTrayProvider>{children}</CompareTrayProvider>
        <ActivityDock />
        <ActivityToasts />
      </ActivityProvider>
    </SettingsProvider>
  );
}
