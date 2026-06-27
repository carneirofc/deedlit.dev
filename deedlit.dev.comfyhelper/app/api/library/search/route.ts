import { handleRoute, jsonOk } from "@/lib/library/http";
import { MetadataSearchRequestSchema } from "@/lib/library/schemas";
import { buildSearchFilter, hitsToCompactResults, search } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browse / metadata / hybrid search. Proxies to the gateway POST /search.
 *
 * Pagination is now REAL server-side offset (gateway -> deedlit.search Qdrant
 * offset), so each page queries the WHOLE matching set and returns exactly one
 * window — no client-side slicing of a fixed top-K, and no O(offset^2) re-fetch.
 * graphScope is accepted by the schema but unsupported by the gateway (no
 * graph-scope resolution endpoint), so it is destructured out. The gateway
 * encodes the text `query` into vectors via deedlit.vision; an empty `query`
 * falls back to a paged catalog browse.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = MetadataSearchRequestSchema.parse(await request.json());
    const { query, limit, offset, graphScope, ...filters } = body;
    void graphScope;
    const res = await search({
      query: query ?? "",
      limit,
      offset,
      filter: buildSearchFilter(filters),
    });
    const results = hitsToCompactResults(res.hits);
    return jsonOk({ results, count: results.length });
  });
}
