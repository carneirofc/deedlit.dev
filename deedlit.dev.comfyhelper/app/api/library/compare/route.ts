import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { CompareRequestSchema } from "@/lib/library/schemas";
import { callMcpTool } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Compare 2-4 images. Proxies to the gateway MCP tool `compare_images`.
 *
 * DEGRADED: that tool is STUBBED in the gateway (no compare-owning service in
 * the decomposed topology yet — see deedlit.api/mcp.py STUBBED_TOOLS). When the
 * gateway returns the stub we surface a 501 so the page can show the feature as
 * unavailable rather than rendering an empty diff.
 * TODO(#17): drop the stub guard once a compare service ships behind the gateway.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = CompareRequestSchema.parse(await request.json());
    const tool = await callMcpTool("compare_images", { image_ids: body.imageIds });
    const structured = (tool.structuredContent ?? {}) as Record<string, unknown>;
    if (structured.stubbed) {
      return jsonError(
        "Image comparison is not available yet: no compare service is wired behind the gateway.",
        501,
      );
    }
    return jsonOk(structured);
  });
}
