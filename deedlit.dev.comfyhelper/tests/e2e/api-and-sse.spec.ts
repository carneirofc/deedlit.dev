import { expect, test } from "@playwright/test";

import { ApiErrorResponseSchema, StatsJsonResponseSchema } from "../../lib/contracts/api";
import { EventsStreamMessageSchema, StatsStreamMessageSchema } from "../../lib/contracts/realtime";

test.describe("API and SSE health", () => {
  test("returns stats payload", async ({ request }) => {
    const response = await request.get("/api/stats");
    expect(response.ok()).toBeTruthy();

    const payload = (await response.json()) as unknown;
    const parsed = StatsJsonResponseSchema.parse(payload);
    expect(typeof parsed.processing).toBe("boolean");
    expect(parsed.stats === null || typeof parsed.stats.totalImages === "number").toBeTruthy();
  });

  test("returns 400 for malformed images query payload", async ({ request }) => {
    const response = await request.get("/api/images?page=bad-page-value");
    expect(response.status()).toBe(400);
    const payload = (await response.json()) as unknown;
    const parsed = ApiErrorResponseSchema.parse(payload);
    expect(parsed.error.length).toBeGreaterThan(0);
  });

  test("accepts SSE v2 connection and emits message envelopes", async ({ page }) => {
    await page.goto("/admin");

    const result = await page.evaluate(async () => {
      return await new Promise<{
        ok: boolean;
        reason?: string;
        messages: Array<{ data: string; id: string }>;
        legacyCounts: Record<string, number>;
      }>((resolve) => {
        const eventSource = new EventSource("/api/events?lastEventId=0");
        const messages: Array<{ data: string; id: string }> = [];
        const legacyCounts = {
          taskEvent: 0,
          taskSnapshot: 0,
          galleryEvent: 0,
          sseReady: 0,
          sseHeartbeat: 0,
        };
        const timeout = window.setTimeout(() => {
          eventSource.close();
          resolve({ ok: false, reason: "timeout", messages, legacyCounts });
        }, 5_000);

        eventSource.onmessage = (event) => {
          messages.push({ data: event.data, id: event.lastEventId ?? "" });
          window.clearTimeout(timeout);
          eventSource.close();
          resolve({ ok: true, messages, legacyCounts });
        };

        eventSource.addEventListener("task-event", () => {
          legacyCounts.taskEvent += 1;
        });
        eventSource.addEventListener("task-snapshot", () => {
          legacyCounts.taskSnapshot += 1;
        });
        eventSource.addEventListener("gallery-event", () => {
          legacyCounts.galleryEvent += 1;
        });
        eventSource.addEventListener("sse-ready", () => {
          legacyCounts.sseReady += 1;
        });
        eventSource.addEventListener("sse-heartbeat", () => {
          legacyCounts.sseHeartbeat += 1;
        });

        eventSource.onerror = () => {
          if (eventSource.readyState === EventSource.CLOSED) {
            window.clearTimeout(timeout);
            resolve({ ok: false, reason: "closed", messages, legacyCounts });
          }
        };
      });
    });

    expect(result.ok, `SSE connection did not open (${result.reason ?? "unknown"})`).toBeTruthy();
    expect(result.messages.length).toBeGreaterThan(0);
    const firstMessage = EventsStreamMessageSchema.parse(JSON.parse(result.messages[0].data));
    expect(firstMessage.channel).toBe("scan");
    expect(firstMessage.type).toBe("scan.snapshot");

    expect(result.legacyCounts.taskEvent).toBe(0);
    expect(result.legacyCounts.taskSnapshot).toBe(0);
    expect(result.legacyCounts.galleryEvent).toBe(0);
    expect(result.legacyCounts.sseReady).toBe(0);
    expect(result.legacyCounts.sseHeartbeat).toBe(0);
  });

  test("replay filter only returns events newer than provided lastEventId", async ({ page, request }) => {
    await page.goto("/admin");

    // Ensure scan events exist in history.
    await request.post("/api/images", {
      data: {},
      headers: { "Content-Type": "application/json" },
    });

    const initialReplay = await page.evaluate(async () => {
      return await new Promise<Array<{ data: string; id: string }>>((resolve) => {
        const eventSource = new EventSource("/api/events?lastEventId=0");
        const messages: Array<{ data: string; id: string }> = [];
        const timeout = window.setTimeout(() => {
          eventSource.close();
          resolve(messages);
        }, 1_500);

        eventSource.onmessage = (event) => {
          messages.push({ data: event.data, id: event.lastEventId ?? "" });
        };

        eventSource.onerror = () => {
          if (eventSource.readyState === EventSource.CLOSED) {
            window.clearTimeout(timeout);
            resolve(messages);
          }
        };
      });
    });

    const initialMessages = initialReplay
      .map((entry) => EventsStreamMessageSchema.parse(JSON.parse(entry.data)))
      .filter((message) => "seq" in message);
    expect(initialMessages.length).toBeGreaterThan(0);

    const lastSeenSeq = Math.max(...initialMessages.map((message) => message.seq));

    const replayAfter = await page.evaluate(async (lastEventId: number) => {
      return await new Promise<Array<{ data: string; id: string }>>((resolve) => {
        const eventSource = new EventSource(`/api/events?lastEventId=${lastEventId}`);
        const messages: Array<{ data: string; id: string }> = [];
        const timeout = window.setTimeout(() => {
          eventSource.close();
          resolve(messages);
        }, 1_500);

        eventSource.onmessage = (event) => {
          messages.push({ data: event.data, id: event.lastEventId ?? "" });
        };

        eventSource.onerror = () => {
          if (eventSource.readyState === EventSource.CLOSED) {
            window.clearTimeout(timeout);
            resolve(messages);
          }
        };
      });
    }, lastSeenSeq);

    const replayedMessages = replayAfter
      .map((entry) => EventsStreamMessageSchema.parse(JSON.parse(entry.data)))
      .filter((message) => "seq" in message);

    expect(replayedMessages.every((message) => message.seq > lastSeenSeq)).toBeTruthy();
  });

  test("stats SSE stream emits typed v2 message envelopes", async ({ page }) => {
    await page.goto("/stats");

    const result = await page.evaluate(async () => {
      return await new Promise<{ ok: boolean; messages: string[]; reason?: string }>((resolve) => {
        const eventSource = new EventSource("/api/stats?stream=1");
        const messages: string[] = [];
        const timeout = window.setTimeout(() => {
          eventSource.close();
          resolve({ ok: false, messages, reason: "timeout" });
        }, 8_000);

        eventSource.onmessage = (event) => {
          messages.push(event.data);
          try {
            const parsed = JSON.parse(event.data) as { type?: string };
            if (parsed.type === "stats.complete" || parsed.type === "stats.error") {
              window.clearTimeout(timeout);
              eventSource.close();
              resolve({ ok: true, messages });
            }
          } catch {
            // ignore parse errors in browser; parser runs on test side
          }
        };

        eventSource.onerror = () => {
          if (eventSource.readyState === EventSource.CLOSED) {
            window.clearTimeout(timeout);
            resolve({ ok: false, messages, reason: "closed" });
          }
        };
      });
    });

    expect(result.messages.length).toBeGreaterThan(0);
    const parsedMessages = result.messages.map((entry) =>
      StatsStreamMessageSchema.parse(JSON.parse(entry)),
    );
    const lastMessage = parsedMessages[parsedMessages.length - 1];
    expect(lastMessage.type === "stats.complete" || lastMessage.type === "stats.error").toBeTruthy();
  });
});
