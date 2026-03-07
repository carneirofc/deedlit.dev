import type { z } from "zod";
import type {
  EditorJsDataSchema,
  PromptNoteSchema,
  PromptNoteSummarySchema,
  PromptNoteImageSchema,
} from "@/lib/contracts/notes";

export type EditorJsData = z.infer<typeof EditorJsDataSchema>;
export type PromptNote = z.infer<typeof PromptNoteSchema>;
export type PromptNoteSummary = z.infer<typeof PromptNoteSummarySchema>;
export type PromptNoteImage = z.infer<typeof PromptNoteImageSchema>;
