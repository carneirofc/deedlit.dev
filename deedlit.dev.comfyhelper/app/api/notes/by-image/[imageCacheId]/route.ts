import { NotesByImageResponseSchema } from "@/lib/contracts/notes-api";
import { errorJson, jsonWithSchema } from "@/lib/http/route-response";
import { findNotesByImage, NoteStoreError } from "@/lib/notes-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ imageCacheId: string }> },
) {
  try {
    const { imageCacheId } = await params;
    const noteReferences = await findNotesByImage(imageCacheId);
    return jsonWithSchema(NotesByImageResponseSchema, { noteReferences });
  } catch (error) {
    if (error instanceof NoteStoreError) {
      return errorJson(error.message, error.status);
    }
    return errorJson("Failed to find note references.", 500);
  }
}
