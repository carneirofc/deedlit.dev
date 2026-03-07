import { ZodError } from "zod";

import {
  NoteIdParamSchema,
  UpdateNoteBodySchema,
  NoteDetailResponseSchema,
  UpdateNoteResponseSchema,
  DeleteNoteResponseSchema,
} from "@/lib/contracts/notes-api";
import { errorJson, jsonWithSchema, zodErrorMessage } from "@/lib/http/route-response";
import { getNote, updateNote, deleteNote, NoteStoreError } from "@/lib/notes-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = NoteIdParamSchema.parse(await context.params);
    const note = await getNote(id);
    return jsonWithSchema(NoteDetailResponseSchema, { note });
  } catch (error) {
    if (error instanceof NoteStoreError) {
      return errorJson(error.message, error.status);
    }
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid note id."), 400);
    }
    return errorJson("Failed to load note.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = NoteIdParamSchema.parse(await context.params);
    const body = UpdateNoteBodySchema.parse(await request.json());
    const note = await updateNote(id, body);
    return jsonWithSchema(UpdateNoteResponseSchema, { note });
  } catch (error) {
    if (error instanceof NoteStoreError) {
      return errorJson(error.message, error.status);
    }
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid request."), 400);
    }
    return errorJson("Failed to update note.", 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = NoteIdParamSchema.parse(await context.params);
    await deleteNote(id);
    return jsonWithSchema(DeleteNoteResponseSchema, { deleted: true });
  } catch (error) {
    if (error instanceof NoteStoreError) {
      return errorJson(error.message, error.status);
    }
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid note id."), 400);
    }
    return errorJson("Failed to delete note.", 500);
  }
}
