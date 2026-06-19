import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { getDetail, GatewayError } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

/**
 * RAW full catalog record for ONE image — the heavy fields the lightweight
 * browse list intentionally omits (workflow_json / api_prompt_json graphs plus
 * params / negative / description). Backs the #30 DB power-user detail panel,
 * which pulls this on demand when a row is opened so those fields never ride
 * every browse page. Resolves via the gateway detail fan-out and returns just
 * its `image` (the catalog truth). A gateway 404 means the image is gone.
 */
export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    try {
      const detail = await getDetail(imageId);
      if (!detail?.image) return jsonError("Image not found.", 404);
      return jsonOk(detail.image);
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) {
        return jsonError("Image not found.", 404);
      }
      throw e;
    }
  });
}
