import { handleRoute, jsonOk } from "@/lib/library/http";
import { reindexImage } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

/** Re-project one image (publish an index task). Gateway POST /images/{sha}/reindex. */
export async function POST(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    return jsonOk(await reindexImage(imageId));
  });
}
