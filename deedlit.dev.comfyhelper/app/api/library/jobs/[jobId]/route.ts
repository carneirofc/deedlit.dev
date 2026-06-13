import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { listJobs } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

/**
 * Single job detail for the admin panel.
 *
 * DEGRADED: the gateway exposes no GET /jobs/{id}; it only lists jobs. We
 * therefore fetch the list and find the requested job. Per-file failure detail
 * (failedFiles) is not available through the gateway, so it is returned empty.
 * TODO(#17): wire per-job detail once the gateway proxies ingest GET /jobs/{id}.
 */
export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { jobId } = await context.params;
    const jobs = await listJobs();
    const job = jobs.find((j) => j.id === jobId || j.job_id === jobId);
    if (!job) return jsonError("Job not found.", 404);
    return jsonOk({ job, failedFiles: [] });
  });
}
