import { handleRoute, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { findRelatedTags } from "@/lib/library/services/graph-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ tag: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { tag } = await context.params;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 20)));
    await ensureLibrarySchema();
    const related = await findRelatedTags(decodeURIComponent(tag), limit);
    return jsonOk({ tag: decodeURIComponent(tag), related });
  });
}
