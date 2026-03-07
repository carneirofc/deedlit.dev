import { atom } from "jotai";

import type { ScanJobInfo } from "@/lib/library-types";

// ---------------------------------------------------------------------------
// Shared types (relocated from app/admin/components/admin-types.ts)
// ---------------------------------------------------------------------------

export type SseConnectionState = "connecting" | "open" | "error" | "closed";

export type SseLastEvent = {
  kind: "scan.queued" | "scan.running" | "scan.completed" | "scan.failed";
  seq: number;
  status: ScanJobInfo["status"];
  jobId: string;
  at: string;
};

// ---------------------------------------------------------------------------
// Core scan atoms – updated by the event hub & query onSuccess callbacks
// ---------------------------------------------------------------------------

/** The live scan job, kept in sync by SSE events and query responses. */
export const scanJobAtom = atom<ScanJobInfo | null>(null);

/** Gallery-oriented human-readable scan feedback. */
export const scanFeedbackAtom = atom<string | null>(null);

/** Admin-oriented status message. */
export const statusMessageAtom = atom<string | null>(null);

/** Image count derived from the most recent scan event. */
export const scanImageCountAtom = atom<number>(0);

// ---------------------------------------------------------------------------
// SSE debug atoms – one per counter to keep re-renders surgical
// ---------------------------------------------------------------------------

export const sseConnectionStateAtom = atom<SseConnectionState>("connecting");
export const sseReadyStateAtom = atom<number | null>(null);
export const sseOpenCountAtom = atom(0);
export const sseErrorCountAtom = atom(0);
export const sseMalformedCountAtom = atom(0);
export const sseTaskEventCountAtom = atom(0);
export const sseSnapshotCountAtom = atom(0);
export const sseGalleryEventCountAtom = atom(0);
export const sseOpenedAtAtom = atom<string | null>(null);
export const sseLastEventAtAtom = atom<string | null>(null);
export const sseLastSnapshotAtAtom = atom<string | null>(null);
export const sseLastErrorAtAtom = atom<string | null>(null);
export const sseLastEventAtom = atom<SseLastEvent | null>(null);
export const sseEventSourceAttachedAtom = atom(false);
