import { useCallback, useEffect, useRef, useState } from "react";

import { StatsStreamMessageSchema } from "@/lib/contracts/realtime";
import type { PromptStatistics } from "@/lib/library-types";

// ---------------------------------------------------------------------------
// Hook state
// ---------------------------------------------------------------------------

export type StreamingStatsState = {
  /** Latest statistics snapshot. Null until the first result arrives. */
  stats: PromptStatistics | null;
  /** SSE connection is open, waiting for the server to respond. */
  isStreaming: boolean;
  /** The final "complete" event has been received. */
  isComplete: boolean;
  /** Waiting for the very first data (no stats yet). */
  isLoading: boolean;
  /** Total images in the result. */
  processedTotal: number;
  /** Elapsed time reported by the server (ms). */
  elapsedMs: number;
  /** Error message, if any. */
  error: string | null;
};

const INITIAL_STATE: StreamingStatsState = {
  stats: null,
  isStreaming: false,
  isComplete: false,
  isLoading: true,
  processedTotal: 0,
  elapsedMs: 0,
  error: null,
};

// ---------------------------------------------------------------------------
// useStreamingStats – SSE-based statistics hook
//
// The server resolves statistics from its cache (maintained by the background
// StatsWorkerService) and sends a single `stats.complete` message once ready.
// The hook only displays the result — no client-side calculation is performed.
// ---------------------------------------------------------------------------

export function useStreamingStats() {
  const [state, setState] = useState<StreamingStatsState>(INITIAL_STATE);
  const esRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(true);

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    disconnect();

    setState((prev) => ({
      ...prev,
      isStreaming: true,
      isComplete: false,
      isLoading: prev.stats === null,
      processedTotal: 0,
      elapsedMs: 0,
      error: null,
    }));

    const es = new EventSource("/api/stats?stream=1");
    esRef.current = es;

    es.addEventListener("message", (e: MessageEvent) => {
      if (!mountedRef.current) return;

      try {
        const raw = JSON.parse(e.data as string) as unknown;
        const message = StatsStreamMessageSchema.parse(raw);

        if (message.type === "stats.error") {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            isLoading: false,
            error: message.payload.message,
          }));
          es.close();
          esRef.current = null;
          return;
        }

        if (message.type === "stats.complete") {
          setState((prev) => ({
            ...prev,
            stats: message.payload.stats,
            isStreaming: false,
            isComplete: true,
            isLoading: false,
            processedTotal: message.payload.processedTotal,
            elapsedMs: message.payload.elapsedMs,
          }));
          es.close();
          esRef.current = null;
          return;
        }

        // stats.batch — server sends intermediate progress; update display but keep streaming.
        if (message.type === "stats.batch") {
          setState((prev) => ({
            ...prev,
            stats: message.payload.stats,
            isLoading: false,
            processedTotal: message.payload.processedTotal,
            elapsedMs: message.payload.elapsedMs,
          }));
        }
      } catch (err) {
        console.error("[useStreamingStats] Failed to parse SSE message", err);
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          isLoading: false,
          error: "Invalid statistics stream payload.",
        }));
      }
    });

    es.onerror = () => {
      if (!mountedRef.current) return;

      if (es.readyState === EventSource.CLOSED) {
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          isLoading: false,
          error: prev.isComplete
            ? null
            : "Connection to statistics stream lost.",
        }));
        esRef.current = null;
      }
    };
  }, [disconnect]);

  // Auto-connect on mount
  useEffect(() => {
    mountedRef.current = true;
    queueMicrotask(connect);
    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [connect, disconnect]);

  /** Reconnect and fetch fresh statistics from the server. */
  const refresh = useCallback(() => {
    connect();
  }, [connect]);

  return { ...state, refresh };
}

