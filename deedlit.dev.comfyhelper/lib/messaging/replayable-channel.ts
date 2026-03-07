import type { ZodTypeAny } from "zod";

import {
  type ReplayableEventsStreamMessage,
  ReplayableEventsStreamMessageSchema,
} from "@/lib/contracts/realtime";
import { createTypedEventBus, type TypedEventHealth } from "@/lib/messaging/event-bus";

type ReplayableChannel = ReplayableEventsStreamMessage["channel"];

type ReplayableChannelMessage<
  TChannel extends ReplayableChannel,
  TTypes extends readonly string[],
> = Extract<ReplayableEventsStreamMessage, { channel: TChannel; type: TTypes[number] }>;

type ReplayableChannelPayload<
  TChannel extends ReplayableChannel,
  TTypes extends readonly string[],
> = ReplayableChannelMessage<TChannel, TTypes>["payload"];

type ReplayableChannelDefinition<
  TChannel extends ReplayableChannel,
  TTypes extends readonly string[],
> = {
  busName: string;
  historyLimit: number;
  channel: TChannel;
  types: TTypes;
  payloadSchemas: Record<TTypes[number], ZodTypeAny>;
};

function parseReplayableChannelMessage<
  TChannel extends ReplayableChannel,
  TTypes extends readonly string[],
>(
  input: unknown,
  channel: TChannel,
  hasType: (value: string) => value is TTypes[number],
): ReplayableChannelMessage<TChannel, TTypes> {
  const parsed = ReplayableEventsStreamMessageSchema.parse(input);
  if (parsed.channel !== channel || !hasType(parsed.type)) {
    throw new Error(
      `Expected replayable ${channel} message but received ${parsed.channel}:${parsed.type}`,
    );
  }

  return parsed as ReplayableChannelMessage<TChannel, TTypes>;
}

export function createReplayableChannel<
  TChannel extends ReplayableChannel,
  TTypes extends readonly string[],
>(definition: ReplayableChannelDefinition<TChannel, TTypes>) {
  const bus = createTypedEventBus(definition.busName, { historyLimit: definition.historyLimit });
  const typeSet = new Set<string>(definition.types);
  const hasType = (value: string): value is TTypes[number] => typeSet.has(value);

  let registered = false;

  const ensureRegistered = () => {
    if (registered) {
      return;
    }

    for (const type of definition.types as readonly TTypes[number][]) {
      bus.register(definition.channel, type, definition.payloadSchemas[type]);
    }
    registered = true;
  };

  const parseMessage = (input: unknown) =>
    parseReplayableChannelMessage(input, definition.channel, hasType);

  const emit = (
    type: TTypes[number],
    payload: Omit<ReplayableChannelPayload<TChannel, TTypes>, "at">,
  ): ReplayableChannelMessage<TChannel, TTypes> => {
    ensureRegistered();
    const event = bus.emit(definition.channel, type, {
      ...payload,
      at: new Date().toISOString(),
    });
    return parseMessage(event);
  };

  const listAfter = (
    lastEventId: string | null | undefined,
    max = 250,
  ): ReplayableChannelMessage<TChannel, TTypes>[] => {
    ensureRegistered();
    return bus
      .listAfter(lastEventId, {
        channels: [definition.channel],
        types: [...definition.types],
        max,
      })
      .map(parseMessage);
  };

  const subscribe = (
    listener: (event: ReplayableChannelMessage<TChannel, TTypes>) => void,
  ): (() => void) => {
    ensureRegistered();
    return bus.subscribe((event) => {
      if (event.channel !== definition.channel || !hasType(event.type)) {
        return;
      }
      listener(parseMessage(event));
    });
  };

  const getHealth = (): TypedEventHealth => {
    ensureRegistered();
    return bus.getHealth();
  };

  return {
    emit,
    listAfter,
    subscribe,
    getHealth,
  };
}
