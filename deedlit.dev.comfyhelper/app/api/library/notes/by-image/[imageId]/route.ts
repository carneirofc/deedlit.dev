import { handleRoute, jsonOk } from "@/lib/library/http";
import { notesByImage } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

/** List notes attached to a specific image. Proxies the gateway GET /notes/by-image/{sha256}. */
export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    const notes = await notesByImage(imageId);
    return jsonOk(notes);
  });
}
