import { handleRoute, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { CompareRequestSchema } from "@/lib/library/schemas";
import { compareImages } from "@/lib/library/services/compare-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = CompareRequestSchema.parse(await request.json());
    await ensureLibrarySchema();
    const result = await compareImages(body.imageIds);
    return jsonOk(result);
  });
}
