import { handleRoute, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { ClusterRequestSchema } from "@/lib/library/schemas";
import { buildClusters } from "@/lib/library/services/cluster-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = ClusterRequestSchema.parse(await request.json());
    await ensureLibrarySchema();
    const result = await buildClusters(body);
    return jsonOk(result);
  });
}
