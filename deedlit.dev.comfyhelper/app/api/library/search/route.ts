import { handleRoute, jsonOk } from "@/lib/library/http";
import { MetadataSearchRequestSchema } from "@/lib/library/schemas";
import { buildSearchFilter, hitsToCompactResults, search } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browse / metadata / hybrid search. Proxies to the gateway POST /search.
 *
 * NOTE: the gateway's search contract takes { query, limit, filter } only — it
 * has no offset/pagination and no graphScope resolution. We therefore page on
 * the client by slicing the gateway result; graphScope is accepted but ignored
 * here (the gateway exposes no graph-scope resolution endpoint). When `query`
 * is empty the gateway still runs (filter-only browse).
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = MetadataSearchRequestSchema.parse(await request.json());
    // graphScope is accepted by the schema but unsupported by the gateway (no
    // graph-scope resolution endpoint); destructure it out so it isn't sent.
    const { query, limit, offset, graphScope, ...filters } = body;
    void graphScope;
    const res = await search({
      query: query ?? "",
      limit: Math.max(limit + offset, limit),
      filter: buildSearchFilter(filters),
    });
    const all = hitsToCompactResults(res.hits);
    const results = offset > 0 ? all.slice(offset, offset + limit) : all.slice(0, limit);
    return jsonOk({ results, count: results.length });
  });
}
