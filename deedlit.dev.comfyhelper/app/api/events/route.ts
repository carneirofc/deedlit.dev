import {
  EventsStreamMessageSchema,
  SystemHeartbeatMessageSchema,
} from "@/lib/contracts/realtime";
import { getLatestScanJob } from "@/lib/image-cache-store";
import { listGalleryEventsAfter, subscribeGalleryEvents } from "@/lib/messaging/gallery";
import { createSseSender } from "@/lib/messaging/sse";
import { createScanSnapshotMessage, listScanEventsAfter, subscribeScanEvents } from "@/lib/messaging/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let unsubscribeScan: (() => void) | null = null;
  let unsubscribeGallery: (() => void) | null = null;
  let heartbeatId: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const url = new URL(request.url);
  const replayFrom = request.headers.get("last-event-id") ?? url.searchParams.get("lastEventId");

  const cleanup = () => {
    if (unsubscribeScan) {
      unsubscribeScan();
      unsubscribeScan = null;
    }
    if (unsubscribeGallery) {
      unsubscribeGallery();
      unsubscribeGallery = null;
    }
    if (heartbeatId) {
      clearInterval(heartbeatId);
      heartbeatId = null;
    }
  };

  const closeStream = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) {
      return;
    }

    closed = true;
    cleanup();
    try {
      controller.close();
    } catch {
      // no-op
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const send = createSseSender(controller);
      const sendMessage = (
        message: unknown,
        options?: {
          id?: string;
          retryMs?: number;
        },
      ) => {
        if (closed) {
          return;
        }

        const parsed = EventsStreamMessageSchema.parse(message);
        send({
          event: "message",
          data: parsed,
          id: options?.id,
          retryMs: options?.retryMs,
        });
      };

      const initialScan = await getLatestScanJob();
      sendMessage(createScanSnapshotMessage({ scan: initialScan, replayFrom }), { retryMs: 2000 });

      const replayEvents = [
        ...listScanEventsAfter(replayFrom, 300),
        ...listGalleryEventsAfter(replayFrom, 300),
      ].sort((a, b) => a.seq - b.seq);

      for (const replay of replayEvents) {
        sendMessage(replay, { id: replay.id });
      }

      const scanListener = (event: ReturnType<typeof listScanEventsAfter>[number]) => {
        sendMessage(event, { id: event.id });
      };
      unsubscribeScan = subscribeScanEvents(scanListener);

      const galleryListener = (event: ReturnType<typeof listGalleryEventsAfter>[number]) => {
        sendMessage(event, { id: event.id });
      };
      unsubscribeGallery = subscribeGalleryEvents(galleryListener);

      heartbeatId = setInterval(() => {
        sendMessage(
          SystemHeartbeatMessageSchema.parse({
            schemaVersion: 2,
            channel: "system",
            type: "system.heartbeat",
            at: new Date().toISOString(),
            payload: {
              at: new Date().toISOString(),
            },
          }),
        );
      }, 15000);

      request.signal.addEventListener("abort", () => {
        closeStream(controller);
      });
    },
    cancel: () => {
      if (closed) {
        return;
      }
      closed = true;
      cleanup();
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
