import { handleRoute, jsonOk } from "@/lib/library/http";
import { IngestFolderRequestSchema } from "@/lib/library/schemas";
import { startIngestion } from "@/lib/library/services/ingest-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = IngestFolderRequestSchema.parse(await request.json());
    const jobId = await startIngestion(body);
    return jsonOk({ job_id: jobId, status: "started" });
  });
}
