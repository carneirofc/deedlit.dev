import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  AddRootBodySchema,
  ApiErrorResponseSchema,
  ImagesResponseSchema,
  RootsListResponseSchema,
  SettingsResponseSchema,
  StartScanResponseSchema,
  StatsJsonResponseSchema,
} from "../../lib/contracts/api";
import {
  EventsStreamMessageSchema,
  StatsStreamMessageSchema,
} from "../../lib/contracts/realtime";

test.describe("Contract schemas", () => {
  test("accepts valid realtime message envelopes", () => {
    const now = new Date().toISOString();
    const rootId = randomUUID();
    const jobId = randomUUID();

    expect(() =>
      EventsStreamMessageSchema.parse({
        schemaVersion: 2,
        id: "1",
        seq: 1,
        channel: "scan",
        type: "scan.queued",
        at: now,
        payload: {
          jobId,
          status: "queued",
          processedFiles: 0,
          totalFiles: 0,
          cachedImages: 0,
          at: now,
        },
      }),
    ).not.toThrow();

    expect(() =>
      EventsStreamMessageSchema.parse({
        schemaVersion: 2,
        id: "2",
        seq: 2,
        channel: "gallery",
        type: "gallery.images.changed",
        at: now,
        payload: {
          count: 1,
          at: now,
          images: [
            {
              id: `${rootId}:image.png`,
              rootId,
              rootPath: "C:/images",
              absolutePath: "C:/images/image.png",
              relativePath: "image.png",
              fileName: "image.png",
              size: 123,
              modifiedAt: now,
            },
          ],
        },
      }),
    ).not.toThrow();

    expect(() =>
      StatsStreamMessageSchema.parse({
        schemaVersion: 2,
        channel: "stats",
        type: "stats.complete",
        at: now,
        payload: {
          stats: {
            totalImages: 1,
            imagesWithPositivePrompt: 1,
            imagesWithNegativePrompt: 0,
            imagesWithModel: 1,
            imagesWithSampler: 1,
            uniquePositiveTags: 1,
            uniqueNegativeTags: 0,
            avgPositiveTagsPerImage: 1,
            avgNegativeTagsPerImage: 0,
            topPositiveTags: [{ label: "tag", count: 1 }],
            topNegativeTags: [],
            topModels: [{ label: "model", count: 1 }],
            topSamplers: [{ label: "sampler", count: 1 }],
            generatedAt: now,
          },
          batchSize: 1,
          processedTotal: 1,
          isLast: true,
          elapsedMs: 10,
        },
      }),
    ).not.toThrow();
  });

  test("rejects invalid realtime message envelopes", () => {
    expect(() =>
      EventsStreamMessageSchema.parse({
        schemaVersion: 2,
        channel: "scan",
        type: "scan.running",
        at: "not-an-iso-time",
        payload: {},
      }),
    ).toThrow();

    expect(() =>
      StatsStreamMessageSchema.parse({
        schemaVersion: 2,
        channel: "stats",
        type: "stats.batch",
        at: new Date().toISOString(),
        payload: {
          isLast: true,
        },
      }),
    ).toThrow();
  });

  test("validates core API request and response contracts", () => {
    const now = new Date().toISOString();
    const rootId = randomUUID();
    const jobId = randomUUID();

    expect(() => AddRootBodySchema.parse({ path: "C:/images" })).not.toThrow();
    expect(() => AddRootBodySchema.parse({ path: "" })).toThrow();

    expect(() =>
      RootsListResponseSchema.parse({
        roots: [{ id: rootId, path: "C:/images", createdAt: now, isVisible: true }],
      }),
    ).not.toThrow();

    expect(() =>
      SettingsResponseSchema.parse({
        settings: { galleryColumns: 7, excludedTags: [], tagFilterPresets: [], trashcanDirectory: null },
      }),
    ).not.toThrow();

    expect(() =>
      StartScanResponseSchema.parse({
        started: true,
        job: {
          id: jobId,
          status: "queued",
          totalFiles: 0,
          processedFiles: 0,
          cachedImages: 0,
          warnings: [],
          createdAt: now,
        },
      }),
    ).not.toThrow();

    expect(() =>
      ImagesResponseSchema.parse({
        roots: [{ id: rootId, path: "C:/images", createdAt: now, isVisible: true }],
        settings: { galleryColumns: 7, excludedTags: [], tagFilterPresets: [], trashcanDirectory: null },
        images: [],
        warnings: [],
        scannedAt: null,
        scan: null,
        total: 0,
      }),
    ).not.toThrow();

    expect(() =>
      StatsJsonResponseSchema.parse({
        stats: null,
        processing: false,
        cache: {
          hasValue: false,
          fresh: false,
          expiresAt: null,
        },
      }),
    ).not.toThrow();

    expect(() =>
      ApiErrorResponseSchema.parse({
        error: "something failed",
      }),
    ).not.toThrow();
  });
});
