import {
  type GalleryImagesChangedPayload,
  type GalleryImagesRemovedPayload,
  type ReplayableEventsStreamMessage,
  GalleryImagesChangedMessageSchema,
  GalleryImagesRemovedMessageSchema,
} from "@/lib/contracts/realtime";
import { createReplayableChannel } from "@/lib/messaging/replayable-channel";

const BUS_NAME = "comfyhelper-public-events";
const HISTORY_LIMIT = 2_000;
const CHANNEL = "gallery" as const;

const REPLAYABLE_TYPES = ["gallery.images.changed", "gallery.images.removed"] as const;

const galleryChannel = createReplayableChannel({
  busName: BUS_NAME,
  historyLimit: HISTORY_LIMIT,
  channel: CHANNEL,
  types: REPLAYABLE_TYPES,
  payloadSchemas: {
    "gallery.images.changed": GalleryImagesChangedMessageSchema.shape.payload,
    "gallery.images.removed": GalleryImagesRemovedMessageSchema.shape.payload,
  },
});

type ReplayableGalleryMessage = Extract<
  ReplayableEventsStreamMessage,
  { channel: "gallery"; type: (typeof REPLAYABLE_TYPES)[number] }
>;

export function emitGalleryImagesChanged(payload: Omit<GalleryImagesChangedPayload, "at">) {
  return galleryChannel.emit("gallery.images.changed", payload);
}

export function emitGalleryImagesRemoved(payload: Omit<GalleryImagesRemovedPayload, "at">) {
  return galleryChannel.emit("gallery.images.removed", payload);
}

export function listGalleryEventsAfter(
  lastEventId: string | null | undefined,
  max = 100,
): ReplayableGalleryMessage[] {
  return galleryChannel.listAfter(lastEventId, max);
}

export function subscribeGalleryEvents(
  listener: (event: ReplayableGalleryMessage) => void,
): () => void {
  return galleryChannel.subscribe(listener);
}
