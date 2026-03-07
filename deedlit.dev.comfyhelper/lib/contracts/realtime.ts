import { z } from "zod";

import {
  ImageRecordSchema,
  PromptStatisticsSchema,
  ScanJobInfoSchema,
  ScanJobStatusSchema,
} from "./domain";

const ReplayIdentitySchema = z.object({
  id: z.string().min(1),
  seq: z.int().min(1),
});

const EnvelopeBaseSchema = z.object({
  schemaVersion: z.literal(2),
  at: z.iso.datetime(),
});

const ReplayableEnvelopeBaseSchema = EnvelopeBaseSchema.extend(ReplayIdentitySchema.shape);

export const ScanSnapshotPayloadSchema = z.object({
  scan: ScanJobInfoSchema.nullable(),
  replayFrom: z.string().nullable().optional(),
});

export const ScanProgressPayloadSchema = z.object({
  jobId: z.uuid(),
  status: ScanJobStatusSchema,
  processedFiles: z.int().nonnegative().optional(),
  totalFiles: z.int().nonnegative().optional(),
  cachedImages: z.int().nonnegative().optional(),
  reusedFiles: z.int().nonnegative().optional(),
  rescannedFiles: z.int().nonnegative().optional(),
  newFiles: z.int().nonnegative().optional(),
  currentRoot: z.string().optional(),
  message: z.string().optional(),
  limitReached: z.boolean().optional(),
  error: z.string().optional(),
  at: z.iso.datetime(),
});

export const GalleryImagesChangedPayloadSchema = z.object({
  images: z.array(ImageRecordSchema).optional(),
  removedIds: z.array(z.string()).optional(),
  jobId: z.uuid().optional(),
  count: z.int().nonnegative(),
  at: z.iso.datetime(),
});

export const GalleryImagesRemovedPayloadSchema = z.object({
  images: z.array(ImageRecordSchema).optional(),
  removedIds: z.array(z.string()).optional(),
  jobId: z.uuid().optional(),
  count: z.int().nonnegative(),
  at: z.iso.datetime(),
});

export const SystemHeartbeatPayloadSchema = z.object({
  at: z.iso.datetime(),
});

export const ScanSnapshotMessageSchema = EnvelopeBaseSchema.extend({
  channel: z.literal("scan"),
  type: z.literal("scan.snapshot"),
  payload: ScanSnapshotPayloadSchema,
});

const ReplayableScanMessageBaseSchema = ReplayableEnvelopeBaseSchema.extend({
  channel: z.literal("scan"),
  payload: ScanProgressPayloadSchema,
});

export const ScanQueuedMessageSchema = ReplayableScanMessageBaseSchema.extend({
  type: z.literal("scan.queued"),
});

export const ScanRunningMessageSchema = ReplayableScanMessageBaseSchema.extend({
  type: z.literal("scan.running"),
});

export const ScanCompletedMessageSchema = ReplayableScanMessageBaseSchema.extend({
  type: z.literal("scan.completed"),
});

export const ScanFailedMessageSchema = ReplayableScanMessageBaseSchema.extend({
  type: z.literal("scan.failed"),
});

const ReplayableGalleryMessageBaseSchema = ReplayableEnvelopeBaseSchema.extend({
  channel: z.literal("gallery"),
});

export const GalleryImagesChangedMessageSchema = ReplayableGalleryMessageBaseSchema.extend({
  type: z.literal("gallery.images.changed"),
  payload: GalleryImagesChangedPayloadSchema,
});

export const GalleryImagesRemovedMessageSchema = ReplayableGalleryMessageBaseSchema.extend({
  type: z.literal("gallery.images.removed"),
  payload: GalleryImagesRemovedPayloadSchema,
});

export const SystemHeartbeatMessageSchema = EnvelopeBaseSchema.extend({
  channel: z.literal("system"),
  type: z.literal("system.heartbeat"),
  payload: SystemHeartbeatPayloadSchema,
});

export const EventsStreamMessageSchema = z.union([
  ScanSnapshotMessageSchema,
  ScanQueuedMessageSchema,
  ScanRunningMessageSchema,
  ScanCompletedMessageSchema,
  ScanFailedMessageSchema,
  GalleryImagesChangedMessageSchema,
  GalleryImagesRemovedMessageSchema,
  SystemHeartbeatMessageSchema,
]);

export const ReplayableEventsStreamMessageSchema = z.union([
  ScanQueuedMessageSchema,
  ScanRunningMessageSchema,
  ScanCompletedMessageSchema,
  ScanFailedMessageSchema,
  GalleryImagesChangedMessageSchema,
  GalleryImagesRemovedMessageSchema,
]);

const StatsStreamPayloadBaseSchema = z.object({
  stats: PromptStatisticsSchema,
  batchSize: z.int().nonnegative(),
  processedTotal: z.int().nonnegative(),
  rootId: z.string().optional(),
  elapsedMs: z.int().nonnegative(),
});

export const StatsBatchPayloadSchema = StatsStreamPayloadBaseSchema.extend({
  isLast: z.literal(false),
});

export const StatsCompletePayloadSchema = StatsStreamPayloadBaseSchema.extend({
  isLast: z.literal(true),
});

export const StatsErrorPayloadSchema = z.object({
  message: z.string().min(1),
});

const StatsEnvelopeBaseSchema = EnvelopeBaseSchema.extend({
  channel: z.literal("stats"),
});

export const StatsBatchMessageSchema = StatsEnvelopeBaseSchema.extend({
  type: z.literal("stats.batch"),
  payload: StatsBatchPayloadSchema,
});

export const StatsCompleteMessageSchema = StatsEnvelopeBaseSchema.extend({
  type: z.literal("stats.complete"),
  payload: StatsCompletePayloadSchema,
});

export const StatsErrorMessageSchema = StatsEnvelopeBaseSchema.extend({
  type: z.literal("stats.error"),
  payload: StatsErrorPayloadSchema,
});

export const StatsStreamMessageSchema = z.union([
  StatsBatchMessageSchema,
  StatsCompleteMessageSchema,
  StatsErrorMessageSchema,
]);

export const RealtimeMessageSchema = z.union([EventsStreamMessageSchema, StatsStreamMessageSchema]);

export type ScanProgressPayload = z.infer<typeof ScanProgressPayloadSchema>;
export type ScanSnapshotPayload = z.infer<typeof ScanSnapshotPayloadSchema>;
export type GalleryImagesChangedPayload = z.infer<typeof GalleryImagesChangedPayloadSchema>;
export type GalleryImagesRemovedPayload = z.infer<typeof GalleryImagesRemovedPayloadSchema>;
export type StatsBatchPayload = z.infer<typeof StatsBatchPayloadSchema>;
export type StatsCompletePayload = z.infer<typeof StatsCompletePayloadSchema>;
export type StatsErrorPayload = z.infer<typeof StatsErrorPayloadSchema>;
export type EventsStreamMessage = z.infer<typeof EventsStreamMessageSchema>;
export type ReplayableEventsStreamMessage = z.infer<typeof ReplayableEventsStreamMessageSchema>;
export type StatsStreamMessage = z.infer<typeof StatsStreamMessageSchema>;
export type RealtimeMessage = z.infer<typeof RealtimeMessageSchema>;
