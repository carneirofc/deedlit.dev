import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { ClusterRequestSchema } from "@/lib/library/schemas";
import { callMcpTool } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cluster the library by embedding similarity. Proxies to the gateway MCP tool
 * `find_image_clusters`.
 *
 * DEGRADED: that tool is STUBBED in the gateway (no cluster-owning service in
 * the decomposed topology yet — see deedlit.api/mcp.py STUBBED_TOOLS). When the
 * gateway returns the stub we surface a 501 so the page can show the feature as
 * unavailable rather than rendering an empty graph.
 * TODO(#17): drop the stub guard once a cluster service ships behind the gateway.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = ClusterRequestSchema.parse(await request.json());
    const tool = await callMcpTool("find_image_clusters", {
      filters: body.filters,
      sample: body.sample,
      neighbors: body.neighbors,
      threshold: body.threshold,
      resolution: body.resolution,
    });
    const structured = (tool.structuredContent ?? {}) as Record<string, unknown>;
    if (structured.stubbed) {
      return jsonError(
        "Clustering is not available yet: no cluster service is wired behind the gateway.",
        501,
      );
    }
    return jsonOk(structured);
  });
}
