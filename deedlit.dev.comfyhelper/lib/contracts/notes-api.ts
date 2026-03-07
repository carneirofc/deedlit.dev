import { z } from "zod";

import {
  EditorJsDataSchema,
  PromptNoteSchema,
  PromptNoteSummarySchema,
} from "./notes";

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const NoteIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export const CreateNoteBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export const UpdateNoteBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    positivePrompt: EditorJsDataSchema.optional(),
    negativePrompt: EditorJsDataSchema.optional(),
    notes: EditorJsDataSchema.optional(),
    sortOrder: z.int().nonnegative().optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.positivePrompt !== undefined ||
      v.negativePrompt !== undefined ||
      v.notes !== undefined ||
      v.sortOrder !== undefined,
    { message: "At least one field must be provided." },
  );

export const AddImageToNoteBodySchema = z.object({
  imageCacheId: z.string().trim().min(1),
});

export const RemoveImageFromNoteBodySchema = z.object({
  imageCacheId: z.string().trim().min(1),
});

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

export const NotesListResponseSchema = z.object({
  notes: z.array(PromptNoteSummarySchema),
});

export const NoteDetailResponseSchema = z.object({
  note: PromptNoteSchema,
});

export const CreateNoteResponseSchema = z.object({
  note: PromptNoteSchema,
});

export const UpdateNoteResponseSchema = z.object({
  note: PromptNoteSchema,
});

export const DeleteNoteResponseSchema = z.object({
  deleted: z.literal(true),
});

export const AddImageToNoteResponseSchema = z.object({
  note: PromptNoteSchema,
});

export const RemoveImageFromNoteResponseSchema = z.object({
  note: PromptNoteSchema,
});

export const NotesByImageResponseSchema = z.object({
  noteReferences: z.array(
    z.object({
      noteId: z.string(),
      noteTitle: z.string(),
    }),
  ),
});
