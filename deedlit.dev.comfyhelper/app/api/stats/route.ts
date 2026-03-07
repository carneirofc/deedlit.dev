import { StatsJsonResponseSchema } from "@/lib/contracts/api";
import {
  StatsCompleteMessageSchema,
  StatsErrorMessageSchema,
} from "@/lib/contracts/realtime";
import { errorJson, jsonWithSchema } from "@/lib/http/route-response";
import { createSseSender } from "@/lib/messaging/sse";
import {
  getPromptStatisticsSnapshot,
  triggerPromptStatisticsRefresh,
} from "@/lib/prompt-statistics-cache";
import { computePromptStatistics } from "@/lib/workers/services/stats-worker-service";
import { getLogger } from "../../../lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = getLogger({ route: "api/stats" });

// ---------------------------------------------------------------------------
// Shared helper: resolve the current (or freshly computed) statistics.
// Uses the server-side cache managed by StatsWorkerService. If the worker
// has an in-flight computation it joins that promise instead of spawning a
// duplicate. Only falls back to a direct compute when the cache is cold
// and no worker run is in progress.
// ---------------------------------------------------------------------------
async function resolveStats() {
  const snapshot = getPromptStatisticsSnapshot();

  if (snapshot.hasValue && snapshot.isFresh && snapshot.value) {
    return { stats: snapshot.value, elapsedMs: 0, fromCache: true };
  }

  const startMs = Date.now();
  const requestId = `route:${Date.now().toString(36)}`;

  const refresh = triggerPromptStatisticsRefresh(
    () => computePromptStatistics(requestId),
    { forceRefresh: false },
  );

  const stats = await (refresh.promise ?? Promise.resolve(snapshot.value));

  if (!stats) {
    throw new Error("Statistics unavailable.");
  }

  return { stats, elapsedMs: Date.now() - startMs, fromCache: false };
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  // ---------------------------------------------------------------------------
  // SSE streaming mode: EventSource connects with ?stream=1
  // ---------------------------------------------------------------------------
  if (url.searchParams.get("stream") === "1") {
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = createSseSender(controller);

        const closeStream = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // no-op
          }
        };

        const sendMessage = (message: unknown) => {
          if (closed) return;
          send({ event: "message", data: message });
        };

        try {
          const { stats, elapsedMs } = await resolveStats();

          if (!closed) {
            sendMessage(
              StatsCompleteMessageSchema.parse({
                schemaVersion: 2,
                channel: "stats",
                type: "stats.complete",
                at: new Date().toISOString(),
                payload: {
                  stats,
                  batchSize: stats.totalImages,
                  processedTotal: stats.totalImages,
                  isLast: true,
                  elapsedMs,
                },
              }),
            );
          }
        } catch (err) {
          logger.error({ err }, "Streaming request failed");
          if (!closed) {
            sendMessage(
              StatsErrorMessageSchema.parse({
                schemaVersion: 2,
                channel: "stats",
                type: "stats.error",
                at: new Date().toISOString(),
                payload: { message: "Failed to load statistics." },
              }),
            );
          }
        } finally {
          closeStream();
        }
      },

      cancel: () => {
        closed = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Regular JSON snapshot mode
  // ---------------------------------------------------------------------------
  try {
    const snapshot = getPromptStatisticsSnapshot();
    const statusCode = !snapshot.hasValue && snapshot.isProcessing ? 202 : 200;

    return jsonWithSchema(
      StatsJsonResponseSchema,
      {
        stats: snapshot.value,
        processing: snapshot.isProcessing,
        cache: {
          hasValue: snapshot.hasValue,
          fresh: snapshot.isFresh,
          expiresAt:
            snapshot.expiresAtMs && Number.isFinite(snapshot.expiresAtMs)
              ? new Date(snapshot.expiresAtMs).toISOString()
              : null,
        },
      },
      { status: statusCode },
    );
  } catch (error) {
    logger.error({ err: error }, "Snapshot request failed");
    return errorJson("Failed to load prompt statistics.", 500);
  }
}
