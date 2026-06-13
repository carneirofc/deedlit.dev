import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { ReindexRequestSchema } from "@/lib/library/schemas";
import { reindexImage } from "@/lib/library/services/ingest-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = ReindexRequestSchema.parse(await request.json());
    await ensureLibrarySchema();
    const result = await reindexImage(body);
    if (!result) return jsonError("Image not found.", 404);
    return jsonOk(result);
  });
}
