import { ZodError } from "zod";

import { ImageDetailQuerySchema, ImageDetailResponseSchema } from "@/lib/contracts/api";
import { errorJson, jsonWithSchema, zodErrorMessage } from "@/lib/http/route-response";
import { listRoots } from "@/lib/config-store";
import { getCachedImageById } from "@/lib/image-cache-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = ImageDetailQuerySchema.parse({
      id: searchParams.get("id") ?? undefined,
    });

    const [roots, image] = await Promise.all([
      listRoots({ visibleOnly: true }),
      getCachedImageById(query.id),
    ]);

    if (!image) {
      return errorJson("Image not found.", 404);
    }

    const visibleRootIds = new Set(roots.map((root) => root.id));
    if (!visibleRootIds.has(image.rootId)) {
      return errorJson("Image is not in a visible root.", 403);
    }

    return jsonWithSchema(ImageDetailResponseSchema, { image });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid image id."), 400);
    }

    return errorJson("Failed to load image metadata.", 500);
  }
}
