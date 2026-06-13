import { handleRoute, jsonOk } from "@/lib/library/http";
import { getImageGraph } from "@/lib/library/services/graph-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    const { searchParams } = new URL(request.url);
    const depth = Math.min(4, Math.max(1, Number(searchParams.get("depth") ?? 1)));
    const relationshipTypes = searchParams
      .get("relationship_types")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const graph = await getImageGraph(imageId, depth, relationshipTypes);
    return jsonOk(graph);
  });
}
