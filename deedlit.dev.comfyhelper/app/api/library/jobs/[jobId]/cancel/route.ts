import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { cancelJob } from "@/lib/library/services/jobs-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { jobId } = await context.params;
    await ensureLibrarySchema();
    const cancelled = await cancelJob(jobId);
    if (!cancelled) return jsonError("Job not found or not cancellable.", 404);
    return jsonOk({ jobId, status: "cancelled" });
  });
}
