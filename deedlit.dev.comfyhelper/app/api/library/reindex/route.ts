import { handleRoute, jsonOk } from "@/lib/library/http";
import { ReindexRequestSchema } from "@/lib/library/schemas";
import { callMcpTool } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-extract metadata and refresh indexes for one image. Proxies to the gateway
 * MCP tool `reindex_image`, which enqueues a deedlit.ingest maintenance job.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = ReindexRequestSchema.parse(await request.json());
    const tool = await callMcpTool("reindex_image", {
      image_id: body.imageId,
      refresh_metadata: body.refreshMetadata,
      refresh_graph: body.refreshGraph,
      refresh_qdrant: body.refreshQdrant,
      run_external_enrichment: body.runExternalEnrichment,
    });
    return jsonOk(tool.structuredContent ?? { status: "started" });
  });
}
