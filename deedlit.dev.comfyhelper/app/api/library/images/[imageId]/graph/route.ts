import { handleRoute, jsonOk } from "@/lib/library/http";
import { callMcpTool, neighborsToGraph, type GraphNeighbor } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

/**
 * Relationship graph around an image. Proxies to the gateway MCP tool
 * `get_image_graph` (-> deedlit.graph /neighbors) and shapes the flat neighbor
 * list into the cytoscape Graph the UI renders.
 *
 * NOTE: the gateway returns a single hop of neighbors, so `depth` is accepted
 * but not deepened beyond what the graph service returns.
 */
export async function GET(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    const { searchParams } = new URL(request.url);
    const relationshipTypes = searchParams
      .get("relationship_types")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const tool = await callMcpTool("get_image_graph", {
      image_id: imageId,
      relationship_types: relationshipTypes,
    });
    const structured = (tool.structuredContent ?? {}) as { neighbors?: GraphNeighbor[] };
    const graph = neighborsToGraph(imageId, structured.neighbors ?? []);
    return jsonOk(graph);
  });
}
