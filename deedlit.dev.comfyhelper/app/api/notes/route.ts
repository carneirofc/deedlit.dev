import { ZodError } from "zod";

import {
  CreateNoteBodySchema,
  CreateNoteResponseSchema,
  NotesListResponseSchema,
} from "@/lib/contracts/notes-api";
import { errorJson, jsonWithSchema, zodErrorMessage } from "@/lib/http/route-response";
import { listNotes, createNote, NoteStoreError } from "@/lib/notes-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const notes = await listNotes();
    return jsonWithSchema(NotesListResponseSchema, { notes });
  } catch (error) {
    if (error instanceof NoteStoreError) {
      return errorJson(error.message, error.status);
    }
    return errorJson("Failed to load notes.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = CreateNoteBodySchema.parse(await request.json());
    const note = await createNote(body.title);
    return jsonWithSchema(CreateNoteResponseSchema, { note }, { status: 201 });
  } catch (error) {
    if (error instanceof NoteStoreError) {
      return errorJson(error.message, error.status);
    }
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid request body."), 400);
    }
    return errorJson("Failed to create note.", 500);
  }
}
