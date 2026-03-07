import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { z } from "zod";

import {
  GalleryImagesChangedMessageSchema,
  GalleryImagesRemovedMessageSchema,
} from "../../lib/contracts/realtime";
import { createTypedEventBus } from "../../lib/messaging/event-bus";
import {
  emitGalleryImagesChanged,
  emitGalleryImagesRemoved,
  listGalleryEventsAfter,
  subscribeGalleryEvents,
} from "../../lib/messaging/gallery";
import { createReplayableChannel } from "../../lib/messaging/replayable-channel";
import {
  createScanSnapshotMessage,
  emitScanEvent,
  getScanEventHealth,
  listScanEventsAfter,
  subscribeScanEvents,
} from "../../lib/messaging/scan";
import { createSseSender, formatSseMessage } from "../../lib/messaging/sse";
import {
  emitWorkerEvent,
  getWorkerEventBusHealth,
  listWorkerEventsAfter,
  registerWorkerEventSchema,
  subscribeWorkerChannel,
  subscribeWorkerKind,
} from "../../lib/messaging/worker";

function createBusName(label: string): string {
  return `unit:${label}:${randomUUID()}`;
}

test.describe("messaging event bus", () => {
  test("validates payloads and supports filtered subscriptions", () => {
    const bus = createTypedEventBus(createBusName("validation"), { historyLimit: 20 });
    bus.register("scan", "scan.running", z.object({ jobId: z.string() }));
    bus.register("scan", "scan.queued", z.object({ jobId: z.string() }));

    const seenTypes: string[] = [];
    const unsubscribe = bus.subscribe(
      (event) => {
        seenTypes.push(event.type);
      },
      {
        channels: ["scan"],
        types: ["scan.running"],
      },
    );

    const emitted = bus.emit("scan", "scan.running", { jobId: "job-1" });
    bus.emit("scan", "scan.queued", { jobId: "job-2" });
    unsubscribe();
    bus.emit("scan", "scan.running", { jobId: "job-3" });

    expect(emitted.channel).toBe("scan");
    expect(emitted.type).toBe("scan.running");
    expect(seenTypes).toEqual(["scan.running"]);
    expect(() => bus.emit("scan", "scan.running", { jobId: 123 })).toThrow();
  });

  test("supports replay filters and max limits", () => {
    const bus = createTypedEventBus(createBusName("filters"), { historyLimit: 20 });
    bus.register("scan", "scan.running", z.object({ step: z.number().int() }));
    bus.register("gallery", "gallery.images.changed", z.object({ count: z.number().int() }));

    const first = bus.emit("scan", "scan.running", { step: 1 });
    bus.emit("gallery", "gallery.images.changed", { count: 1 });
    const third = bus.emit("scan", "scan.running", { step: 2 });

    const scanOnly = bus.listAfter("0", {
      channels: ["scan"],
      types: ["scan.running"],
      max: 20,
    });
    expect(scanOnly.map((event) => event.id)).toEqual([first.id, third.id]);

    const latestOnly = bus.listAfter("0", { max: 1 });
    expect(latestOnly).toHaveLength(1);
    expect(latestOnly[0]?.id).toBe(third.id);

    const invalidLastEventId = bus.listAfter("not-a-number");
    expect(invalidLastEventId).toHaveLength(3);
  });

  test("trims replay history and skips non-replayable events", () => {
    const bus = createTypedEventBus(createBusName("history"), { historyLimit: 2 });
    bus.register("scan", "scan.running", z.object({ step: z.number().int() }));

    bus.emit("scan", "scan.running", { step: 1 });
    const nonReplayable = bus.emit("scan", "scan.running", { step: 2 }, { replayable: false });
    const third = bus.emit("scan", "scan.running", { step: 3 });
    const fourth = bus.emit("scan", "scan.running", { step: 4 });

    const replayed = bus.listAfter("0");
    expect(replayed.map((event) => event.id)).toEqual([third.id, fourth.id]);
    expect(replayed.some((event) => event.id === nonReplayable.id)).toBeFalsy();
  });
});

test.describe("replayable channels", () => {
  test("emits typed events and ignores non-configured message types", () => {
    const busName = createBusName("replayable-channel");
    const removedChannel = createReplayableChannel({
      busName,
      historyLimit: 20,
      channel: "gallery",
      types: ["gallery.images.removed"] as const,
      payloadSchemas: {
        "gallery.images.removed": GalleryImagesRemovedMessageSchema.shape.payload,
      },
    });

    const sharedBus = createTypedEventBus(busName, { historyLimit: 20 });
    sharedBus.register(
      "gallery",
      "gallery.images.changed",
      GalleryImagesChangedMessageSchema.shape.payload,
    );

    let seenCount = 0;
    const unsubscribe = removedChannel.subscribe(() => {
      seenCount += 1;
    });

    sharedBus.emit("gallery", "gallery.images.changed", {
      count: 1,
      at: new Date().toISOString(),
    });
    expect(seenCount).toBe(0);

    const emitted = removedChannel.emit("gallery.images.removed", {
      count: 2,
      removedIds: ["img-1"],
    });
    unsubscribe();

    expect(emitted.channel).toBe("gallery");
    expect(emitted.type).toBe("gallery.images.removed");
    expect(Number.isNaN(Date.parse(emitted.payload.at))).toBeFalsy();

    const replayed = removedChannel.listAfter("0", 10);
    expect(replayed.some((event) => event.id === emitted.id)).toBeTruthy();
  });
});

test.describe("scan and gallery messaging", () => {
  test("maps scan status to event type and supports replay", () => {
    const baseline = getScanEventHealth().seq;
    const emitted = emitScanEvent({
      jobId: randomUUID(),
      status: "running",
      processedFiles: 10,
      totalFiles: 100,
      cachedImages: 4,
      message: "Scanning",
    });

    expect(emitted.channel).toBe("scan");
    expect(emitted.type).toBe("scan.running");
    expect(emitted.payload.status).toBe("running");
    expect(Number.isNaN(Date.parse(emitted.payload.at))).toBeFalsy();

    const replayed = listScanEventsAfter(String(baseline), 50);
    expect(replayed.some((event) => event.id === emitted.id)).toBeTruthy();
  });

  test("subscribes to scan events and creates snapshot messages", () => {
    const jobId = randomUUID();
    let seenId: string | null = null;

    const unsubscribe = subscribeScanEvents((event) => {
      if (event.payload.jobId === jobId) {
        seenId = event.id;
      }
    });

    const emitted = emitScanEvent({
      jobId,
      status: "queued",
      message: "Queued",
    });
    unsubscribe();

    expect(seenId).toBe(emitted.id);

    const snapshot = createScanSnapshotMessage({ scan: null });
    expect(snapshot.channel).toBe("scan");
    expect(snapshot.type).toBe("scan.snapshot");
    expect(snapshot.payload.scan).toBeNull();
    expect(snapshot.payload.replayFrom).toBeNull();
  });

  test("emits, subscribes, and replays gallery events", () => {
    const baseline = getScanEventHealth().seq;
    const changed = emitGalleryImagesChanged({ count: 1 });
    const removed = emitGalleryImagesRemoved({ count: 1, removedIds: ["image-a"] });

    const replayed = listGalleryEventsAfter(String(baseline), 25);
    const replayIds = new Set(replayed.map((event) => event.id));
    expect(replayIds.has(changed.id)).toBeTruthy();
    expect(replayIds.has(removed.id)).toBeTruthy();

    let seenId: string | null = null;
    const unsubscribe = subscribeGalleryEvents((event) => {
      seenId = event.id;
    });

    const emitted = emitGalleryImagesChanged({ count: 1 });
    unsubscribe();
    expect(seenId).toBe(emitted.id);
  });
});

test.describe("worker messaging", () => {
  test("supports default worker subscriptions and replay queries", () => {
    const baseline = getWorkerEventBusHealth().seq;
    const seenByChannel: string[] = [];
    const seenSpecificKind: string[] = [];

    const unsubscribeChannel = subscribeWorkerChannel("worker-manager", (event) => {
      seenByChannel.push(event.kind);
    });
    const unsubscribeKind = subscribeWorkerKind("worker-manager", "service.started", (event) => {
      seenSpecificKind.push(event.id);
    });

    emitWorkerEvent("scan-coordinator", "coordinator.started", {
      debounceMs: 500,
      cooldownMs: 0,
    });
    const emitted = emitWorkerEvent("worker-manager", "service.started", {
      name: "indexer",
    });

    unsubscribeChannel();
    unsubscribeKind();

    expect(seenByChannel).toContain("service.started");
    expect(seenByChannel).not.toContain("coordinator.started");
    expect(seenSpecificKind).toEqual([emitted.id]);

    const replayed = listWorkerEventsAfter(String(baseline), {
      channel: "worker-manager",
      max: 20,
    });
    expect(replayed.some((event) => event.id === emitted.id)).toBeTruthy();
  });

  test("supports custom worker schemas and rejects unregistered kinds", () => {
    registerWorkerEventSchema(
      "unit-worker",
      "ping",
      z.object({
        ok: z.boolean(),
      }),
    );

    const emitted = emitWorkerEvent("unit-worker", "ping", { ok: true });
    expect(emitted.channel).toBe("unit-worker");
    expect(emitted.kind).toBe("ping");
    expect(emitted.payload).toEqual({ ok: true });

    expect(() => emitWorkerEvent("unit-worker", "missing", {})).toThrow(/not registered/i);
  });
});

test.describe("sse helpers", () => {
  test("formats SSE frames", () => {
    const frame = formatSseMessage({
      retryMs: 2500,
      id: "42",
      event: "custom",
      data: { ok: true },
    });

    expect(frame).toBe("retry: 2500\nid: 42\nevent: custom\ndata: {\"ok\":true}\n\n");
  });

  test("encodes and enqueues SSE frames", () => {
    const chunks: Uint8Array[] = [];
    const controller = {
      enqueue: (chunk: Uint8Array) => {
        chunks.push(chunk);
      },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    const send = createSseSender(controller, new TextEncoder());
    send({
      data: { hello: "world" },
    });

    expect(chunks).toHaveLength(1);
    const text = new TextDecoder().decode(chunks[0]);
    expect(text).toContain("event: message");
    expect(text).toContain("data: {\"hello\":\"world\"}");
  });
});
