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
    });
    const structured = (tool.structuredContent ?? {}) as { results?: SearchHit[] };
    let results = hitsToCompactResults(structured.results ?? []);
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
