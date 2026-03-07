import { EventEmitter } from "node:events";

import type { ZodTypeAny } from "zod";

const BUS_EVENT_NAME = "message";
const DEFAULT_HISTORY_LIMIT = 1_000;

type GlobalBusStore = {
  emitter: EventEmitter;
  seq: number;
  createdAt: string;
  historyLimit: number;
  history: TypedEventEnvelope[];
  payloadSchemas: Map<string, ZodTypeAny>;
};

declare global {
  var __comfyhelperTypedEventBuses: Map<string, GlobalBusStore> | undefined;
}

export type TypedEventEnvelope = {
  schemaVersion: number;
  id: string;
  seq: number;
  channel: string;
  type: string;
  at: string;
  payload: unknown;
};

export type TypedEventHealth = {
  alive: boolean;
  createdAt: string;
  seq: number;
  historySize: number;
  historyLimit: number;
  listenerCount: number;
  oldestEventAt: string | null;
  newestEventAt: string | null;
};

export type TypedEventFilter = {
  channels?: string[];
  types?: string[];
};

function getRegistry(): Map<string, GlobalBusStore> {
  if (!globalThis.__comfyhelperTypedEventBuses) {
    globalThis.__comfyhelperTypedEventBuses = new Map();
  }
  return globalThis.__comfyhelperTypedEventBuses;
}

function getEventKey(channel: string, type: string): string {
  return `${channel}::${type}`;
}

function parseEventId(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function trimHistory(history: TypedEventEnvelope[], historyLimit: number): void {
  if (history.length <= historyLimit) {
    return;
  }

  history.splice(0, history.length - historyLimit);
}

function getOrCreateStore(name: string, historyLimit: number): GlobalBusStore {
  const registry = getRegistry();
  const existing = registry.get(name);
  if (existing) {
    return existing;
  }

  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const store: GlobalBusStore = {
    emitter,
    seq: 0,
    createdAt: new Date().toISOString(),
    historyLimit,
    history: [],
    payloadSchemas: new Map(),
  };

  registry.set(name, store);
  return store;
}

export function createTypedEventBus(
  name: string,
  options?: {
    historyLimit?: number;
  },
) {
  const store = getOrCreateStore(name, options?.historyLimit ?? DEFAULT_HISTORY_LIMIT);

  const register = (channel: string, type: string, payloadSchema: ZodTypeAny) => {
    store.payloadSchemas.set(getEventKey(channel, type), payloadSchema);
  };

  const hasRegistration = (channel: string, type: string): boolean => {
    return store.payloadSchemas.has(getEventKey(channel, type));
  };

  const emit = (
    channel: string,
    type: string,
    payload: unknown,
    options?: {
      schemaVersion?: number;
      replayable?: boolean;
    },
  ): TypedEventEnvelope => {
    const schema = store.payloadSchemas.get(getEventKey(channel, type));
    if (!schema) {
      throw new Error(
        `Typed event bus "${name}" has no payload schema registered for ${channel}:${type}`,
      );
    }

    const parsedPayload = schema.parse(payload);
    const at = new Date().toISOString();
    const seq = ++store.seq;

    const envelope: TypedEventEnvelope = {
      schemaVersion: options?.schemaVersion ?? 2,
      id: String(seq),
      seq,
      channel,
      type,
      at,
      payload: parsedPayload,
    };

    if (options?.replayable ?? true) {
      store.history.push(envelope);
      trimHistory(store.history, store.historyLimit);
    }

    store.emitter.emit(BUS_EVENT_NAME, envelope);
    return envelope;
  };

  const subscribe = (
    listener: (event: TypedEventEnvelope) => void,
    filter?: TypedEventFilter,
  ): (() => void) => {
    const wrapped = (event: TypedEventEnvelope) => {
      if (filter?.channels && filter.channels.length > 0 && !filter.channels.includes(event.channel)) {
        return;
      }
      if (filter?.types && filter.types.length > 0 && !filter.types.includes(event.type)) {
        return;
      }
      listener(event);
    };

    store.emitter.on(BUS_EVENT_NAME, wrapped);
    return () => {
      store.emitter.off(BUS_EVENT_NAME, wrapped);
    };
  };

  const listAfter = (
    lastEventId: string | null | undefined,
    options?: {
      channels?: string[];
      types?: string[];
      max?: number;
    },
  ): TypedEventEnvelope[] => {
    const fromSeq = parseEventId(lastEventId);
    const max = options?.max ?? 250;

    let events = store.history.filter((event) => event.seq > fromSeq);
    if (options?.channels && options.channels.length > 0) {
      events = events.filter((event) => options.channels?.includes(event.channel));
    }
    if (options?.types && options.types.length > 0) {
      events = events.filter((event) => options.types?.includes(event.type));
    }

    return events.length <= max ? events : events.slice(-max);
  };

  const getHealth = (): TypedEventHealth => {
    const oldest = store.history[0];
    const newest = store.history[store.history.length - 1];
    return {
      alive: true,
      createdAt: store.createdAt,
      seq: store.seq,
      historySize: store.history.length,
      historyLimit: store.historyLimit,
      listenerCount: store.emitter.listenerCount(BUS_EVENT_NAME),
      oldestEventAt: oldest?.at ?? null,
      newestEventAt: newest?.at ?? null,
    };
  };

  return {
    register,
    hasRegistration,
    emit,
    subscribe,
    listAfter,
    getHealth,
  };
}
