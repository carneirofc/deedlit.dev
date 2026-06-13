import { z } from "zod";

import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { getImageDetail, setFavorite, setRating } from "@/lib/library/repositories/image-repository";
import { syncImageToGraph } from "@/lib/library/services/graph-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

const PatchSchema = z.object({
  rating: z.number().int().min(0).max(5).nullable().optional(),
  favorite: z.boolean().optional(),
});

export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    await ensureLibrarySchema();
    const detail = await getImageDetail(imageId);
    if (!detail) return jsonError("Image not found.", 404);
    return jsonOk(detail);
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    const body = PatchSchema.parse(await request.json());
    await ensureLibrarySchema();
    if (body.rating !== undefined) await setRating(imageId, body.rating);
    if (body.favorite !== undefined) await setFavorite(imageId, body.favorite);
    await syncImageToGraph(imageId).catch(() => {});
    const detail = await getImageDetail(imageId);
    if (!detail) return jsonError("Image not found.", 404);
    return jsonOk(detail);
  });
}
