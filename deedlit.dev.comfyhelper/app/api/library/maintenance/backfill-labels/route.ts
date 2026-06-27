import { handleRoute, jsonOk } from "@/lib/library/http";
import { dispatchJob } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Backfill AI labels for every cataloged image missing a description. Dispatches
 * a `label-backfill` maintenance job through the gateway POST /jobs (routed to
 * deedlit.ingest, which relabels each via the existing reindex path). Execution
 * is owned by ingest.
 */
export async function POST() {
  return handleRoute(async () => jsonOk(await dispatchJob({ type: "label-backfill" })));
}
