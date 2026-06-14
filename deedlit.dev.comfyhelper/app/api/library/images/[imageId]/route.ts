import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { getDetail, imageToUiDetail, deleteImage, GatewayError } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    try {
      const detail = await getDetail(imageId);
      if (!detail?.image) return jsonError("Image not found.", 404);
      return jsonOk(imageToUiDetail(detail.image));
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) {
        return jsonError("Image not found.", 404);
      }
      throw e;
    }
  });
}

/**
 * Rating / favorite mutation.
 *
 * DEGRADED: the deedlit.api gateway exposes no write proxy for catalog mutable
 * fields (the catalog has PUT /images/{sha}/rating|favorite, but the gateway
 * does not surface them — see contracts/api.openapi.yaml). comfyhelper is
 * UI-only and may not call the catalog directly, so this returns 501 until the
 * gateway adds a mutation endpoint.
 * TODO(#17): wire favorite/rating once the gateway proxies catalog writes.
 */
export async function PATCH() {
  return jsonError(
    "Editing rating/favorite is not available: the gateway does not yet proxy catalog writes.",
    501,
  );
}

/**
 * Un-index an image. Proxies the gateway DELETE /images/{sha256}, which removes
 * the catalog record + search vector + graph node — NOT the source file on
 * disk. A gateway 404 means the image is not in the library.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    try {
      return jsonOk(await deleteImage(imageId));
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) {
        return jsonError("Image not found.", 404);
      }
      throw e;
    }
  });
}
