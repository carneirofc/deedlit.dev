import { handleRoute, jsonOk } from "@/lib/library/http";
import { dispatchJob } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rebuild the vector index. Dispatches a maintenance job through the gateway
 * POST /jobs (routed to deedlit.ingest). Execution is owned by ingest.
 */
export async function POST() {
  // deedlit.ingest names the vector-store rebuild `rebuild-search` (the Qdrant
  // projection is owned by deedlit.search); the old `rebuild-qdrant` 422s.
  return handleRoute(async () => jsonOk(await dispatchJob({ type: "rebuild-search" })));
}
