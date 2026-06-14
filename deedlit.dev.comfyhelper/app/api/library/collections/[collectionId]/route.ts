import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import {
  getCollection,
  renameCollection,
  deleteCollection,
  GatewayError,
} from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ collectionId: string }> };

/** Read a collection. Proxies the gateway GET /collections/{id} (-> catalog). */
export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { collectionId } = await context.params;
    try {
      return jsonOk(await getCollection(collectionId));
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) return jsonError("Collection not found.", 404);
      throw e;
    }
  });
}

/** Rename a collection. Proxies the gateway PUT /collections/{id} (-> catalog). */
export async function PUT(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { collectionId } = await context.params;
    const { name } = (await request.json()) as { name: string };
    try {
      return jsonOk(await renameCollection(collectionId, name));
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) return jsonError("Collection not found.", 404);
      throw e;
    }
  });
}

/** Delete a collection. Proxies the gateway DELETE /collections/{id} (-> catalog). */
export async function DELETE(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { collectionId } = await context.params;
    try {
      await deleteCollection(collectionId);
      return jsonOk({ status: "ok" });
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) return jsonError("Collection not found.", 404);
      throw e;
    }
  });
}
