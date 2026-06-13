import { handleRoute, jsonOk } from "@/lib/library/http";
import { callMcpTool } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

/**
 * Image lineage (variant/upscale/inpaint chain). Proxies to the gateway MCP
 * tool `find_image_lineage` (-> deedlit.graph /lineage).
 */
export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    const tool = await callMcpTool("find_image_lineage", { image_id: imageId });
    return jsonOk(tool.structuredContent ?? {});
  });
}
