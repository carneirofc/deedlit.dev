import { handleRoute, jsonOk } from "@/lib/library/http";
import { createNote, type NoteUpsert } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create a note. Proxies the gateway POST /notes (-> catalog). */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = (await request.json()) as NoteUpsert;
    const note = await createNote(body);
    return jsonOk(note);
  });
}
