import { handleRoute, jsonOk } from "@/lib/library/http";
import { dispatchJob } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Regenerate missing thumbnails. Dispatches a maintenance job through the
 * gateway POST /jobs (routed to deedlit.ingest). Execution is owned by ingest.
 */
export async function POST() {
  // deedlit.ingest names the thumbnail rebuild `rebuild-thumbnails`; the old
  // `regenerate-thumbnails` 422s.
  return handleRoute(async () => jsonOk(await dispatchJob({ type: "rebuild-thumbnails" })));
}
