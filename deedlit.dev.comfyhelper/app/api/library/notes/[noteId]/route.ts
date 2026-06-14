import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { getNote, updateNote, GatewayError, type NoteUpsert } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ noteId: string }> };

/** Read a note. Proxies the gateway GET /notes/{id} (-> catalog). */
export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { noteId } = await context.params;
    try {
      return jsonOk(await getNote(noteId));
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) return jsonError("Note not found.", 404);
      throw e;
    }
  });
}

/** Update a note. Proxies the gateway PUT /notes/{id} (-> catalog). */
export async function PUT(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { noteId } = await context.params;
    const body = (await request.json()) as NoteUpsert;
    try {
      return jsonOk(await updateNote(noteId, body));
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) return jsonError("Note not found.", 404);
      throw e;
    }
  });
}
