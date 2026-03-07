import { ZodError } from "zod";

import {
  NoteIdParamSchema,
  AddImageToNoteBodySchema,
  RemoveImageFromNoteBodySchema,
  AddImageToNoteResponseSchema,
  RemoveImageFromNoteResponseSchema,
} from "@/lib/contracts/notes-api";
import { errorJson, jsonWithSchema, zodErrorMessage } from "@/lib/http/route-response";
import { addImageToNote, removeImageFromNote, NoteStoreError } from "@/lib/notes-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: noteId } = NoteIdParamSchema.parse(await context.params);
    const body = AddImageToNoteBodySchema.parse(await request.json());
    const note = await addImageToNote(noteId, body.imageCacheId);
    return jsonWithSchema(AddImageToNoteResponseSchema, { note });
  } catch (error) {
    if (error instanceof NoteStoreError) {
      return errorJson(error.message, error.status);
    }
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid request."), 400);
    }
    return errorJson("Failed to add image to note.", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id: noteId } = NoteIdParamSchema.parse(await context.params);
    const body = RemoveImageFromNoteBodySchema.parse(await request.json());
    const note = await removeImageFromNote(noteId, body.imageCacheId);
    return jsonWithSchema(RemoveImageFromNoteResponseSchema, { note });
  } catch (error) {
    if (error instanceof NoteStoreError) {
      return errorJson(error.message, error.status);
    }
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid request."), 400);
    }
    return errorJson("Failed to remove image from note.", 500);
  }
}
