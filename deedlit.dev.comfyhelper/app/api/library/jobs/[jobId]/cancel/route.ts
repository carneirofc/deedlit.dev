import { jsonError } from "@/lib/library/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cancel a running job.
 *
 * DEGRADED: the deedlit.api gateway exposes no job-cancel endpoint (it can
 * dispatch jobs via POST /jobs and list them, but not cancel one). Returns 501
 * until the gateway proxies an ingest cancel route.
 * TODO(#17): wire cancellation once the gateway exposes it.
 */
export async function POST() {
  return jsonError("Job cancellation is not available through the gateway.", 501);
}
