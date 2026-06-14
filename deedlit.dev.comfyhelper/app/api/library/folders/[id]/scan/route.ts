import { handleRoute, jsonOk } from "@/lib/library/http";
import { scanSourceFolder } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * "Scan now" — dispatch an immediate ingest scan of a configured folder.
 * Proxies the gateway POST /folders/{id}/scan, which resolves the folder path
 * and enqueues an ingest job. Returns the dispatched job id for the activity dock.
 */
export async function POST(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { id } = await context.params;
    const res = await scanSourceFolder(id);
    return jsonOk({ job_id: res.id ?? res.job_id ?? null, status: res.status ?? "started" });
  });
}
