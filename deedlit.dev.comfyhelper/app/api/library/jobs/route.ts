import { handleRoute, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { listJobs } from "@/lib/library/services/jobs-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    await ensureLibrarySchema();
    return jsonOk({ jobs: await listJobs() });
  });
}
