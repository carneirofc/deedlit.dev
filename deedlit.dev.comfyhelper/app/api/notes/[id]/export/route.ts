import { ZodError } from "zod";

import { NoteIdParamSchema } from "@/lib/contracts/notes-api";
import { errorJson, zodErrorMessage } from "@/lib/http/route-response";
import { getNote, NoteStoreError } from "@/lib/notes-store";
import { formatNoteExport } from "@/lib/notes-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = NoteIdParamSchema.parse(await context.params);
    const note = await getNote(id);
    const content = formatNoteExport(note);
    const filename = `${note.title.replace(/[^a-zA-Z0-9_\- ]/g, "_").trim()}.txt`;

    return new Response(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof NoteStoreError) {
      return errorJson(error.message, error.status);
    }
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid note id."), 400);
    }
    return errorJson("Failed to export note.", 500);
  }
}
