import type { ZodTypeAny } from "zod";

import { WorkerEventPayloadSchemas } from "@/lib/contracts/worker";
import { createTypedEventBus } from "@/lib/messaging/event-bus";
import type { WorkerEvent, WorkerEventListener } from "@/lib/workers/worker-types";

const BUS_NAME = "comfyhelper-worker-events";
const HISTORY_LIMIT = 2_000;

const bus = createTypedEventBus(BUS_NAME, { historyLimit: HISTORY_LIMIT });
let defaultsRegistered = false;

function registerPayloadSchema(channel: string, kind: string, schema: ZodTypeAny) {
  if (bus.hasRegistration(channel, kind)) {
    return;
  }

  bus.register(channel, kind, schema);
}

function ensureDefaultRegistration() {
  if (defaultsRegistered) {
    return;
  }

  for (const [channel, kinds] of Object.entries(WorkerEventPayloadSchemas)) {
    for (const [kind, schema] of Object.entries(kinds)) {
      registerPayloadSchema(channel, kind, schema);
    }
  }

  defaultsRegistered = true;
}

export function registerWorkerEventSchema(channel: string, kind: string, schema: ZodTypeAny) {
  registerPayloadSchema(channel, kind, schema);
}

function toWorkerEvent(input: {
  schemaVersion: number;
  id: string;
  seq: number;
  channel: string;
  type: string;
  at: string;
  payload: unknown;
}): WorkerEvent {
  return {
    schemaVersion: input.schemaVersion,
    id: input.id,
    seq: input.seq,
    channel: input.channel,
    kind: input.type,
    at: input.at,
    payload: input.payload,
  };
}

export function emitWorkerEvent(channel: string, kind: string, payload: unknown): WorkerEvent {
  ensureDefaultRegistration();
  if (!bus.hasRegistration(channel, kind)) {
    throw new Error(
      `Worker event payload schema is not registered for ${channel}:${kind}. ` +
        `Register with registerWorkerEventSchema(channel, kind, schema).`,
    );
  }

  const event = bus.emit(channel, kind, payload);
  return toWorkerEvent(event);
}

export function subscribeAllWorkerEvents(listener: WorkerEventListener): () => void {
  ensureDefaultRegistration();
  return bus.subscribe((event) => {
    listener(toWorkerEvent(event));
  });
}

export function subscribeWorkerChannel(channel: string, listener: WorkerEventListener): () => void {
  ensureDefaultRegistration();
  return bus.subscribe(
    (event) => {
      listener(toWorkerEvent(event));
    },
    { channels: [channel] },
  );
}

export function subscribeWorkerKind(
  channel: string,
  kind: string,
  listener: WorkerEventListener,
): () => void {
  ensureDefaultRegistration();
  return bus.subscribe(
    (event) => {
      listener(toWorkerEvent(event));
    },
    { channels: [channel], types: [kind] },
  );
}

export function listWorkerEventsAfter(
  lastEventId: string | null | undefined,
  options?: { channel?: string; max?: number },
): WorkerEvent[] {
  ensureDefaultRegistration();
  const events = bus.listAfter(lastEventId, {
    channels: options?.channel ? [options.channel] : undefined,
    max: options?.max ?? 250,
  });
  return events.map((event) => toWorkerEvent(event));
}

export function getWorkerEventBusHealth() {
  ensureDefaultRegistration();
  return bus.getHealth();
}
