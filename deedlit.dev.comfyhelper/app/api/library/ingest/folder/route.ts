import { handleRoute, jsonOk } from "@/lib/library/http";
import { IngestFolderRequestSchema } from "@/lib/library/schemas";
import { dispatchJob } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dispatch a folder ingestion. Proxies to the gateway POST /jobs; a payload
 * carrying `folderPath` is routed by the gateway to deedlit.ingest /ingest.
 *
 * The actual ingest pipeline is owned by deedlit.ingest (out of scope here);
 * comfyhelper only dispatches the job through the gateway and reports the id.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = IngestFolderRequestSchema.parse(await request.json());
    const res = await dispatchJob({ ...body });
    return jsonOk({
      job_id: res.id ?? res.job_id ?? null,
      status: res.status ?? "started",
    });
  });
}
