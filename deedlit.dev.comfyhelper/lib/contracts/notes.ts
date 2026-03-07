import { z } from "zod";

// ---------------------------------------------------------------------------
// Editor.js OutputData shape (structural envelope validated, block data opaque)
// ---------------------------------------------------------------------------

const EditorJsBlockSchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const EditorJsDataSchema = z
  .object({
    time: z.number().optional(),
    blocks: z.array(EditorJsBlockSchema),
    version: z.string().optional(),
  })
  .default({ blocks: [] });

// ---------------------------------------------------------------------------
// Domain schemas
// ---------------------------------------------------------------------------

export const PromptNoteImageSchema = z.object({
  id: z.string().trim().min(1),
  imageCacheId: z.string().trim().min(1),
  sortOrder: z.int().nonnegative(),
  addedAt: z.iso.datetime(),
});

export const PromptNoteSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().max(200),
  positivePrompt: EditorJsDataSchema,
  negativePrompt: EditorJsDataSchema,
  notes: EditorJsDataSchema,
  sortOrder: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  images: z.array(PromptNoteImageSchema),
});

export const PromptNoteSummarySchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().max(200),
  sortOrder: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  imageCount: z.int().nonnegative(),
});
