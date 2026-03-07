"use client";

import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";

import { type EventsStreamMessage, EventsStreamMessageSchema } from "@/lib/contracts/realtime";
import type { ImageRecord, ScanJobInfo } from "@/lib/library-types";
import { queryKeys } from "@/lib/queries/query-keys";
import type { LibraryData } from "@/lib/queries/use-library";
import {
  scanJobAtom,
  scanFeedbackAtom,
  statusMessageAtom,
  scanImageCountAtom,
  sseConnectionStateAtom,
  sseReadyStateAtom,
  sseOpenCountAtom,
  sseErrorCountAtom,
  sseMalformedCountAtom,
  sseTaskEventCountAtom,
  sseSnapshotCountAtom,
  sseGalleryEventCountAtom,
  sseOpenedAtAtom,
  sseLastEventAtAtom,
  sseLastSnapshotAtAtom,
  sseLastErrorAtAtom,
  sseLastEventAtom,
  sseEventSourceAttachedAtom,
} from "@/lib/store/scan-atoms";

// ---------------------------------------------------------------------------
// Event hub hook — mounted ONCE at provider level
// ---------------------------------------------------------------------------

export function useEventHub() {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);

  // Scan atoms
  const setScanJob = useSetAtom(scanJobAtom);
  const setScanFeedback = useSetAtom(scanFeedbackAtom);
  const setStatusMessage = useSetAtom(statusMessageAtom);
  const setScanImageCount = useSetAtom(scanImageCountAtom);

  // SSE debug atoms
  const setSseConnectionState = useSetAtom(sseConnectionStateAtom);
  const setSseReadyState = useSetAtom(sseReadyStateAtom);
  const setSseOpenCount = useSetAtom(sseOpenCountAtom);
  const setSseErrorCount = useSetAtom(sseErrorCountAtom);
  const setSseMalformedCount = useSetAtom(sseMalformedCountAtom);
  const setSseTaskEventCount = useSetAtom(sseTaskEventCountAtom);
  const setSseSnapshotCount = useSetAtom(sseSnapshotCountAtom);
  const setSseGalleryEventCount = useSetAtom(sseGalleryEventCountAtom);
  const setSseOpenedAt = useSetAtom(sseOpenedAtAtom);
  const setSseLastEventAt = useSetAtom(sseLastEventAtAtom);
  const setSseLastSnapshotAt = useSetAtom(sseLastSnapshotAtAtom);
  const setSseLastErrorAt = useSetAtom(sseLastErrorAtAtom);
  const setSseLastEvent = useSetAtom(sseLastEventAtom);
  const setSseEventSourceAttached = useSetAtom(sseEventSourceAttachedAtom);

  useEffect(() => {
    const eventSource = new EventSource("/api/events");
    eventSourceRef.current = eventSource;
    setSseConnectionState("connecting");
    setSseReadyState(eventSource.readyState);
    setSseEventSourceAttached(true);

    const readyStateTimer = window.setInterval(() => {
      setSseReadyState(eventSource.readyState);
    }, 1000);

    // ---- Throttled gallery event batching ----
    // During scans, gallery.images.changed events arrive rapidly (every 80 images).
    // Instead of patching the query cache on every event (triggering full UI re-renders
    // including tag enrichment, path tree rebuilds, and tag count recomputation),
    // we buffer incoming images and flush them in a single cache update.
    const GALLERY_FLUSH_INTERVAL_MS = 1500;
    let pendingChangedImages: ImageRecord[] = [];
    let pendingRemovedIds: string[] = [];
    let galleryFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushGalleryBatch = () => {
      galleryFlushTimer = null;

      if (pendingChangedImages.length > 0) {
        const incomingImages = pendingChangedImages;
        pendingChangedImages = [];

        queryClient.setQueryData<LibraryData>(queryKeys.library(), (old) => {
          if (!old) return old;

          const existingIndex = new Map(old.images.map((img) => [img.id, img]));
          const newImages: ImageRecord[] = [];
          const updatedIds = new Set<string>();

          for (const img of incomingImages) {
            if (existingIndex.has(img.id)) {
              updatedIds.add(img.id);
              existingIndex.set(img.id, img);
            } else {
              newImages.push(img);
            }
          }

          const merged = old.images.map((img) =>
            updatedIds.has(img.id) ? (existingIndex.get(img.id) ?? img) : img,
          );

          return {
            ...old,
            images: [...newImages, ...merged],
            total: old.total + newImages.length,
          };
        });
      }

      if (pendingRemovedIds.length > 0) {
        const removedSet = new Set(pendingRemovedIds);
        pendingRemovedIds = [];

        queryClient.setQueryData<LibraryData>(queryKeys.library(), (old) => {
          if (!old) return old;
          const filtered = old.images.filter((img) => !removedSet.has(img.id));
          return {
            ...old,
            images: filtered,
            total: Math.max(0, old.total - (old.images.length - filtered.length)),
          };
        });
      }
    };

    const scheduleGalleryFlush = () => {
      if (!galleryFlushTimer) {
        galleryFlushTimer = setTimeout(flushGalleryBatch, GALLERY_FLUSH_INTERVAL_MS);
      }
    };

    const handleScanProgress = (message: Extract<EventsStreamMessage, { channel: "scan" }>) => {
      if (message.type === "scan.snapshot") {
        const nextScan = message.payload.scan ?? null;
        setSseSnapshotCount((c) => c + 1);
        setSseLastSnapshotAt(new Date().toISOString());
        setScanJob(nextScan);
        if (nextScan) {
          setScanImageCount(nextScan.cachedImages);
        }
        return;
      }

      const payload = message.payload;
      setSseTaskEventCount((c) => c + 1);
      setSseLastEventAt(new Date().toISOString());
      setSseLastEvent({
        kind: message.type,
        seq: message.seq,
        status: payload.status,
        jobId: payload.jobId,
        at: payload.at,
      });

      setScanJob((current) => {
        const base: ScanJobInfo = current ?? {
          id: payload.jobId,
          status: payload.status,
          totalFiles: payload.totalFiles ?? 0,
          processedFiles: payload.processedFiles ?? 0,
          cachedImages: payload.cachedImages ?? 0,
          warnings: [],
          createdAt: new Date().toISOString(),
        };

        return {
          ...base,
          id: payload.jobId,
          status: payload.status,
          totalFiles: payload.totalFiles ?? base.totalFiles,
          processedFiles: payload.processedFiles ?? base.processedFiles,
          cachedImages: payload.cachedImages ?? base.cachedImages,
          error: payload.error ?? base.error,
        };
      });

      if (typeof payload.cachedImages === "number") {
        setScanImageCount(payload.cachedImages);
      }

      const nextFeedback = payload.message
        ? `${payload.message}${
            typeof payload.reusedFiles === "number" && typeof payload.rescannedFiles === "number"
              ? ` (reused: ${payload.reusedFiles}, rescanned: ${payload.rescannedFiles}, new: ${payload.newFiles ?? 0})`
              : ""
          }`
        : payload.currentRoot
          ? `Scanning: ${payload.currentRoot}`
          : null;
      if (nextFeedback) {
        setScanFeedback(nextFeedback);
      }

      if (payload.message) {
        const suffix =
          typeof payload.reusedFiles === "number" && typeof payload.rescannedFiles === "number"
            ? ` (reused: ${payload.reusedFiles}, rescanned: ${payload.rescannedFiles}, new: ${payload.newFiles ?? 0})`
            : "";
        setStatusMessage(`${payload.message}${suffix}`);
      }

      if (payload.status === "completed" || payload.status === "failed") {
        if (payload.status === "completed") {
          setStatusMessage("Library scan completed.");
          setScanFeedback(null);
        } else {
          setStatusMessage("Library scan failed.");
          setScanFeedback(payload.error ?? "Library scan failed.");
        }
        // Flush any pending gallery events immediately before invalidating
        if (galleryFlushTimer) {
          clearTimeout(galleryFlushTimer);
          galleryFlushTimer = null;
        }
        flushGalleryBatch();

        void queryClient.invalidateQueries({ queryKey: queryKeys.library() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.roots() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.stats() });
      }
    };

    const handleGalleryEvent = (message: Extract<EventsStreamMessage, { channel: "gallery" }>) => {
      setSseGalleryEventCount((c) => c + 1);

      if (message.type === "gallery.images.changed" && message.payload.images) {
        pendingChangedImages.push(...message.payload.images);
        scheduleGalleryFlush();
      }

      if (message.type === "gallery.images.removed" && message.payload.removedIds) {
        pendingRemovedIds.push(...message.payload.removedIds);
        scheduleGalleryFlush();
      }
    };

    // ---- message handler ----
    const handleMessage = (event: MessageEvent<string>) => {
      try {
        const raw = JSON.parse(event.data) as unknown;
        const message = EventsStreamMessageSchema.parse(raw);

        if (message.channel === "scan") {
          handleScanProgress(message);
          return;
        }

        if (message.channel === "gallery") {
          handleGalleryEvent(message);
          return;
        }
      } catch {
        setSseMalformedCount((c) => c + 1);
      }
    };

    // ---- connection lifecycle ----
    eventSource.onopen = () => {
      setSseConnectionState("open");
      setSseOpenCount((c) => c + 1);
      setSseOpenedAt(new Date().toISOString());
      setSseReadyState(eventSource.readyState);
      setStatusMessage((current) =>
        current === "Realtime scan updates disconnected. Attempting to reconnect..." ? null : current,
      );
      setScanFeedback((current) =>
        current === "Realtime scan updates disconnected. Attempting to reconnect..." ? null : current,
      );
    };

    eventSource.onerror = () => {
      setSseConnectionState("error");
      setSseErrorCount((c) => c + 1);
      setSseLastErrorAt(new Date().toISOString());
      setSseReadyState(eventSource.readyState);
      setStatusMessage("Realtime scan updates disconnected. Attempting to reconnect...");
      setScanFeedback("Realtime scan updates disconnected. Attempting to reconnect...");
    };

    eventSource.addEventListener("message", handleMessage as EventListener);

    return () => {
      window.clearInterval(readyStateTimer);
      if (galleryFlushTimer) {
        clearTimeout(galleryFlushTimer);
        galleryFlushTimer = null;
      }
      flushGalleryBatch();
      eventSource.removeEventListener("message", handleMessage as EventListener);
      eventSource.close();
      eventSourceRef.current = null;
      setSseConnectionState("closed");
      setSseReadyState(2);
      setSseEventSourceAttached(false);
    };
    // queryClient is stable. Atom setters are stable. No real deps change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
