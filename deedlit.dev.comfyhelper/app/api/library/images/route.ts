import { handleRoute, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { searchImagesByMetadata } from "@/lib/library/services/search-service";
import { SearchFiltersSchema } from "@/lib/library/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/library/images?query=&tags=a,b&model_family=sdxl&limit=&offset= */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const { searchParams } = new URL(request.url);
    const csv = (key: string) =>
      searchParams.get(key)?.split(",").map((s) => s.trim()).filter(Boolean);
    const filters = SearchFiltersSchema.parse({
      tags: csv("tags"),
      excludeTags: csv("exclude_tags"),
      modelFamily: searchParams.get("model_family") ?? undefined,
      checkpoint: searchParams.get("checkpoint") ?? undefined,
      loras: csv("loras"),
      ratingGte: searchParams.get("rating_gte") ? Number(searchParams.get("rating_gte")) : undefined,
      favorite: searchParams.get("favorite") === "true" ? true : undefined,
      sourceTool: searchParams.get("source_tool") ?? undefined,
    });
    const limit = Math.min(200, Number(searchParams.get("limit") ?? 50));
    const offset = Math.max(0, Number(searchParams.get("offset") ?? 0));
    const query = searchParams.get("query") ?? undefined;

    await ensureLibrarySchema();
    const results = await searchImagesByMetadata({ ...filters, query }, limit, offset);
    return jsonOk({ results, count: results.length, limit, offset });
  });
}
