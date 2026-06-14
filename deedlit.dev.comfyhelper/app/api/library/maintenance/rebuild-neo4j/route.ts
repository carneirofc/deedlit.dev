import { handleRoute, jsonOk } from "@/lib/library/http";
import { dispatchJob } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rebuild the relationship graph. Dispatches a maintenance job through the
 * gateway POST /jobs (routed to deedlit.ingest). Execution is owned by ingest.
 */
export async function POST() {
  // deedlit.ingest names the graph rebuild `rebuild-graph` (the Neo4j projection
  // is owned by deedlit.graph); the old `rebuild-neo4j` 422s.
  return handleRoute(async () => jsonOk(await dispatchJob({ type: "rebuild-graph" })));
}
