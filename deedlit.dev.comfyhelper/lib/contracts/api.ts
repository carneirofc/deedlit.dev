import { z } from "zod";

import {
  AppSettingsSchema,
  ImageRecordSchema,
  PromptStatisticsSchema,
  RootDirectorySchema,
  SettingsPatchSchema as DomainSettingsPatchSchema,
  ScanJobInfoSchema,
  ScanResultSchema,
} from "./domain";

function parseIntegerString(label: string, minimum: number, maximum: number) {
  return z
    .string()
    .trim()
    .min(1)
    .transform((value, context) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) {
        context.addIssue({
          code: "custom",
          message: `${label} must be a valid integer`,
        });
        return z.NEVER;
      }

      return parsed;
    })
    .pipe(z.int().min(minimum).max(maximum));
}

export const ApiErrorResponseSchema = z.object({
  error: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const AddRootBodySchema = z.object({
  path: z.string().min(1),
});

export const RootVisibilityPatchBodySchema = z.object({
  isVisible: z.boolean(),
});

export const RouteIdSchema = z.object({
  id: z.uuid(),
});

export const ImageQuerySchema = z.object({
  path: z.string().min(1),
  format: z.enum(["webp"]).optional(),
});

export const RevealImageBodySchema = z.object({
  path: z.string().min(1),
});

export const RevealImageResponseSchema = z.object({
  revealed: z.literal(true),
});

export const ImageDetailQuerySchema = z.object({
  id: z.string().trim().min(1),
});

export const SettingsPatchSchema = DomainSettingsPatchSchema;

export const ImagesQuerySchema = z.object({
  limit: parseIntegerString("limit", 1, 10_000).optional(),
  page: parseIntegerString("page", 1, 100_000).optional(),
  pageSize: parseIntegerString("pageSize", 1, 200).optional(),
  search: z.string().trim().max(300).optional(),
});

export const StartScanBodySchema = z
  .object({
    force: z.boolean().optional(),
  })
  .optional();

export const DeleteCachedImageBodySchema = z.object({
  id: z.string().trim().min(1),
});

export const DeleteImageBodySchema = z.object({
  id: z.string().trim().min(1),
  path: z.string().min(1),
});

export const DeleteImagesBodySchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(5_000),
});

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

export const RootsListResponseSchema = z.object({
  roots: z.array(RootDirectorySchema),
});

export const AddRootResponseSchema = z.object({
  root: RootDirectorySchema,
});

export const RemoveRootResponseSchema = z.object({
  ok: z.literal(true),
});

export const UpdateRootVisibilityResponseSchema = z.object({
  root: RootDirectorySchema,
});

export const SettingsResponseSchema = z.object({
  settings: AppSettingsSchema,
});

export const ImagesResponseSchema = ScanResultSchema;

export const StartScanResponseSchema = z.object({
  job: ScanJobInfoSchema,
  started: z.boolean(),
});

export const DeleteCachedImageResponseSchema = z.object({
  deleted: z.literal(true),
});

export const DeleteImageResponseSchema = z.object({
  deleted: z.literal(true),
});

export const DeleteImagesResponseSchema = z.object({
  total: z.int().positive(),
  moved: z.int().nonnegative(),
  movedPaths: z.array(z.string().min(1)),
  failed: z.array(
    z.object({
      path: z.string().min(1),
      error: z.string().min(1),
    }),
  ),
});

export const ImageDetailResponseSchema = z.object({
  image: ImageRecordSchema,
});

export const SystemInfoResponseSchema = z.object({
  sqlite: z.object({
    relativePath: z.string(),
    absolutePath: z.string(),
    fileSizeBytes: z.number().int().nonnegative().nullable(),
  }),
  database: z.object({
    tableRows: z.object({
      rootDirectories: z.int().nonnegative(),
      appSettings: z.int().nonnegative(),
      imageCache: z.int().nonnegative(),
      scanJobs: z.int().nonnegative(),
    }),
    roots: z.object({
      total: z.int().nonnegative(),
      visible: z.int().nonnegative(),
      hidden: z.int().nonnegative(),
    }),
  }),
  library: z.object({
    visibleCachedImages: z.int().nonnegative(),
  }),
});

export const StatsJsonResponseSchema = z.object({
  stats: PromptStatisticsSchema.nullable(),
  processing: z.boolean(),
  cache: z.object({
    hasValue: z.boolean(),
    fresh: z.boolean(),
    expiresAt: z.iso.datetime().nullable(),
  }),
});

export const EventBusHealthResponseSchema = z.object({
  alive: z.boolean(),
  createdAt: z.iso.datetime(),
  seq: z.int().nonnegative(),
  historySize: z.int().nonnegative(),
  historyLimit: z.int().positive(),
  listenerCount: z.int().nonnegative(),
  oldestEventAt: z.iso.datetime().nullable(),
  newestEventAt: z.iso.datetime().nullable(),
});
