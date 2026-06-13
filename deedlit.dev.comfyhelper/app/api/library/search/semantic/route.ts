import { handleRoute, jsonOk } from "@/lib/library/http";
import { SemanticSearchRequestSchema } from "@/lib/library/schemas";
import { buildSearchFilter, hitsToCompactResults, search } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Natural-language search. Proxies to the gateway POST /search (hybrid
 * dense+sparse via deedlit.search). minScore is applied client-side because the
 * gateway search contract has no score threshold.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = SemanticSearchRequestSchema.parse(await request.json());
    const res = await search({
      query: body.query,
      limit: body.limit,
      filter: buildSearchFilter(body.filters),
    });
    let results = hitsToCompactResults(res.hits);
    if (body.minScore > 0) {
      results = results.filter((r) => (r.score ?? 0) >= body.minScore);
    }
    return jsonOk({
      results,
      count: results.length,
      provider: "deedlit.search",
      semantic: true,
    });
  });
}
