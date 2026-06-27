import { handleRoute, jsonOk } from "@/lib/library/http";
import { dispatchJob } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prune orphaned graph entries. Dispatches a maintenance job through the gateway
 * POST /jobs (routed to deedlit.ingest, which calls deedlit.graph POST /prune).
 *
 * Sweeps the structurally-orphaned :Asset/:Tag nodes that image deletes leave
 * behind (delete_image keeps an Asset/Tag a deleted image pointed at, since other
 * images may still use it; one left with no remaining edge is dead weight).
 */
export async function POST() {
  return handleRoute(async () => jsonOk(await dispatchJob({ type: "prune-graph-orphans" })));
}
