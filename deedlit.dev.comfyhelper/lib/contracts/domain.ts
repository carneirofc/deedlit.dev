import { z } from "zod";

const ExcludedTagsSchema = z
  .array(z.string().trim().min(2).max(140))
  .max(500)
  .transform((values) => Array.from(new Set(values.map((value) => value.toLowerCase()))));

const PresetTagsSchema = z
  .array(z.string().trim().min(1).max(140))
  .max(400)
  .transform((values) => Array.from(new Set(values.map((value) => value.toLowerCase()))));

const TrashcanDirectorySchema = z.string().trim().min(1).max(4096);

const GenerationDetailEntrySchema = z.object({
  label: z.string().trim().min(1),
  value: z.string().trim().min(1),
});

const WorkflowInputEntrySchema = z.object({
  index: z.int().min(0),
  name: z.string().trim().min(1),
  type: z.string().trim().min(1).optional(),
  value: z.string().trim().min(1).optional(),
});

const WorkflowNodeEntrySchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  type: z.string().trim().min(1),
  note: z.string().trim().min(1).optional(),
  inputs: z.array(WorkflowInputEntrySchema),
  searchText: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  outputCount: z.int().min(0),
});

const WorkflowEdgeSchema = z.object({
  id: z.string().trim().min(1),
  fromNodeId: z.string().trim().min(1),
  toNodeId: z.string().trim().min(1),
  toInputName: z.string().trim().min(1),
  fromOutputIndex: z.int().min(0),
  toInputIndex: z.int().min(0),
});

const TagFilterPresetSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(80),
    positiveTags: PresetTagsSchema,
    negativeTags: PresetTagsSchema,
    createdAt: z.iso.datetime(),
  })
  .refine((value) => value.positiveTags.length > 0 || value.negativeTags.length > 0, {
    message: "Each preset must include at least one positive or negative tag.",
  });

const TagFilterPresetsSchema = z.array(TagFilterPresetSchema).max(80);

export const RootDirectorySchema = z.object({
  id: z.uuid(),
  path: z.string().min(1),
  createdAt: z.iso.datetime(),
  isVisible: z.boolean(),
});

export const RootDirectoryListSchema = z.array(RootDirectorySchema);

export const AppSettingsSchema = z.object({
  galleryColumns: z.int().min(3).max(12),
  galleryImageLimit: z.int().min(1000).max(50000),
  excludedTags: ExcludedTagsSchema,
  tagFilterPresets: TagFilterPresetsSchema,
  trashcanDirectory: TrashcanDirectorySchema.nullable(),
});

export const SettingsPatchSchema = z
  .object({
    galleryColumns: z.int().min(3).max(12).optional(),
    galleryImageLimit: z.int().min(1000).max(50000).optional(),
    excludedTags: ExcludedTagsSchema.optional(),
    tagFilterPresets: TagFilterPresetsSchema.optional(),
    trashcanDirectory: TrashcanDirectorySchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.galleryColumns !== undefined ||
      value.galleryImageLimit !== undefined ||
      value.excludedTags !== undefined ||
      value.tagFilterPresets !== undefined ||
      value.trashcanDirectory !== undefined,
    {
      message: "At least one setting must be provided.",
    },
  );

export const PromptSummarySchema = z.object({
  positivePrompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  model: z.string().optional(),
  sampler: z.string().optional(),
});

export const GenerationDetailsSchema = z.object({
  positivePrompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  model: z.string().optional(),
  sampler: z.string().optional(),
  scheduler: z.string().optional(),
  cfgScale: z.string().optional(),
  steps: z.string().optional(),
  seed: z.string().optional(),
  size: z.string().optional(),
  metadataSource: z.string().optional(),
  additional: z.array(GenerationDetailEntrySchema),
});

export const WorkflowDetailsSchema = z.object({
  workflowId: z.string().optional(),
  nodes: z.array(WorkflowNodeEntrySchema),
  edges: z.array(WorkflowEdgeSchema),
  noteNodeCount: z.int().min(0),
  minX: z.number(),
  minY: z.number(),
  maxX: z.number(),
  maxY: z.number(),
});

export const ImageRecordSchema = z.object({
  id: z.string().trim().min(1),
  rootId: z.uuid(),
  rootPath: z.string().min(1),
  absolutePath: z.string().min(1),
  relativePath: z.string().min(1),
  fileName: z.string().min(1),
  size: z.number().nonnegative(),
  modifiedAt: z.iso.datetime(),
  metadataPath: z.string().min(1).optional(),
  metadata: z.unknown().optional(),
  metadataError: z.string().min(1).optional(),
  promptSummary: PromptSummarySchema.optional(),
  generationDetails: GenerationDetailsSchema.optional(),
  workflowDetails: WorkflowDetailsSchema.nullable().optional(),
});

export const ScanJobStatusSchema = z.enum(["queued", "running", "completed", "failed"]);

export const ScanJobInfoSchema = z.object({
  id: z.uuid(),
  status: ScanJobStatusSchema,
  totalFiles: z.int().nonnegative(),
  processedFiles: z.int().nonnegative(),
  cachedImages: z.int().nonnegative(),
  warnings: z.array(z.string()),
  error: z.string().optional(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  finishedAt: z.iso.datetime().optional(),
});

export const ScanResultSchema = z.object({
  roots: RootDirectoryListSchema,
  settings: AppSettingsSchema,
  images: z.array(ImageRecordSchema),
  warnings: z.array(z.string()),
  scannedAt: z.iso.datetime().nullable(),
  scan: ScanJobInfoSchema.nullable().optional(),
  total: z.int().nonnegative().optional(),
  page: z.int().min(1).optional(),
  pageSize: z.int().min(1).optional(),
  search: z.string().optional(),
  truncated: z.boolean().optional(),
  limitApplied: z.int().min(1).optional(),
});

export const TagMetricSchema = z.object({
  label: z.string(),
  count: z.int().nonnegative(),
});

export const PromptStatisticsSchema = z.object({
  totalImages: z.int().nonnegative(),
  imagesWithPositivePrompt: z.int().nonnegative(),
  imagesWithNegativePrompt: z.int().nonnegative(),
  imagesWithModel: z.int().nonnegative(),
  imagesWithSampler: z.int().nonnegative(),
  uniquePositiveTags: z.int().nonnegative(),
  uniqueNegativeTags: z.int().nonnegative(),
  avgPositiveTagsPerImage: z.number().nonnegative(),
  avgNegativeTagsPerImage: z.number().nonnegative(),
  topPositiveTags: z.array(TagMetricSchema),
  topNegativeTags: z.array(TagMetricSchema),
  topModels: z.array(TagMetricSchema),
  topSamplers: z.array(TagMetricSchema),
  generatedAt: z.iso.datetime(),
});

type PathTreeNodeContract = {
  key: string;
  label: string;
  displayPath: string;
  imageCount: number;
  parentKey: string | null;
  children: PathTreeNodeContract[];
};

export const PathTreeNodeSchema: z.ZodType<PathTreeNodeContract> = z.lazy(() =>
  z.object({
    key: z.string(),
    label: z.string(),
    displayPath: z.string(),
    imageCount: z.int().nonnegative(),
    parentKey: z.string().nullable(),
    children: z.array(PathTreeNodeSchema),
  }),
);
