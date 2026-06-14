import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { setCollectionImages, GatewayError } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ collectionId: string }> };

/**
 * Replace a collection's ordered membership. Proxies the gateway
 * PUT /collections/{id}/images (-> catalog) with set/replace semantics: the
 * `images` array is the complete, ordered sha256 list (add/remove/reorder).
 */
export async function PUT(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { collectionId } = await context.params;
    const { images } = (await request.json()) as { images: string[] };
    try {
      await setCollectionImages(collectionId, Array.isArray(images) ? images : []);
      return jsonOk({ status: "ok" });
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) return jsonError("Collection not found.", 404);
      throw e;
    }
  });
}
