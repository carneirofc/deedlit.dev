import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { getJob } from "@/lib/library/services/jobs-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { jobId } = await context.params;
    await ensureLibrarySchema();
    const result = await getJob(jobId);
    if (!result) return jsonError("Job not found.", 404);
    return jsonOk(result);
  });
}
