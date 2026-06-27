import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { getImage, GatewayError } from "@/lib/api-client";

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
      // Full catalog record (incl. workflow_json/api_prompt_json) for the raw-JSON
      // inspector — but a pure catalog read, not the /detail fan-out, so opening a
      // row no longer fires an unused search /similar + graph /neighbors query.
      const image = await getImage(imageId);
      return jsonOk(image);
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) {
        return jsonError("Image not found.", 404);
      }
      throw e;
    }
  });
}
