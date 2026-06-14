import { handleRoute, jsonOk } from "@/lib/library/http";
import { relabelImage } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

/** Re-label one image (publish a label task). Gateway POST /images/{sha}/relabel. */
export async function POST(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    return jsonOk(await relabelImage(imageId));
  });
}
