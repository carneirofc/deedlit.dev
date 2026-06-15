import { handleRoute, jsonOk } from "@/lib/library/http";
import { CatalogBrowseRequestSchema } from "@/lib/library/schemas";
import { catalogImageToCompactResult, listCatalogImages } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Filter-only browse over the catalog TRUTH (gateway GET /images) — the path the
 * library grid takes when there is no text query. Unlike POST /search (vector,
 * relevance-ranked, requires a query, paged by slicing), this has real
 * server-side `sort` + offset pagination and surfaces newest-first by default,
 * so it also backs the "new images arriving" freshness poll.
 *
 * Returns CompactResult rows (the same card shape the search path emits) plus
 * `hasMore`, which is true when the page came back full (offset+limit might have
 * more behind it).
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = CatalogBrowseRequestSchema.parse(await request.json());
    const images = await listCatalogImages({
      tags: body.tags,
      excludeTags: body.excludeTags,
      favorite: body.favorite,
      ratingGte: body.ratingGte,
      safety: body.safety,
      sort: body.sort,
      limit: body.limit,
      offset: body.offset,
    });
    const results = images.map(catalogImageToCompactResult);
    return jsonOk({ results, count: results.length, hasMore: results.length === body.limit });
  });
}
