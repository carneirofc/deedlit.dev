import { handleRoute, jsonOk } from "@/lib/library/http";
import { SimilarSearchRequestSchema } from "@/lib/library/schemas";
import { callMcpTool, hitsToCompactResults, type SearchHit } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Find images similar to a selected one. Proxies to the gateway MCP tool
 * `find_similar_images` (-> deedlit.search /similar).
 *
 * NOTE: the gateway has no graphScope / minScore / hnswEf / exact knobs, so
 * those request fields are accepted for compatibility but not forwarded.
 * minScore is applied client-side here.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = SimilarSearchRequestSchema.parse(await request.json());
    const tool = await callMcpTool("find_similar_images", {
      image_id: body.imageId,
      limit: body.limit,
      offset: body.offset,
      // Forward the active facet filter so by-image results honour the same
      // safety/tag filter as text search (tags/excludeTags/safety apply on the
      // vector path; the gateway translates them to a Qdrant filter).
      ...(body.filters ? { filters: body.filters } : {}),
    });
    const structured = (tool.structuredContent ?? {}) as { results?: SearchHit[] };
    const raw = hitsToCompactResults(structured.results ?? []);
    let results = raw;
    // minScore is a client-side cutoff; the gateway has no minScore knob. Hits
    // come back sorted by descending score, so the first time a full page drops
    // any row below the threshold we've reached the boundary — nothing deeper
    // can qualify, so stop paging there.
    let cutoff = false;
    if (body.minScore > 0) {
      results = raw.filter((r) => (r.score ?? 0) >= body.minScore);
      cutoff = results.length < raw.length;
    }
    // A full page (raw === requested limit) means more neighbours likely exist;
    // a short page is the end. The minScore boundary also ends paging.
    const hasMore = raw.length >= body.limit && !cutoff;
    return jsonOk({
      results,
      count: results.length,
      hasMore,
      provider: "deedlit.search",
      semantic: true,
    });
  });
}
