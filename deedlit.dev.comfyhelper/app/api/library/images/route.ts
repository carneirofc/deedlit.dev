import { handleRoute, jsonOk } from "@/lib/library/http";
import { SearchFiltersSchema } from "@/lib/library/schemas";
import { buildSearchFilter, hitsToCompactResults, search } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/library/images?query=&tags=a,b&model_family=sdxl&limit=&offset=
 *
 * Proxies to the gateway POST /search. The gateway has no offset param, so we
 * slice the result for pagination.
 */
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
    const query = searchParams.get("query") ?? "";

    const res = await search({
      query,
      limit: limit + offset,
      filter: buildSearchFilter(filters),
    });
    const all = hitsToCompactResults(res.hits);
    const results = offset > 0 ? all.slice(offset, offset + limit) : all.slice(0, limit);
    return jsonOk({ results, count: results.length, limit, offset });
  });
}
