import { stat } from "node:fs/promises";

import { ZodError } from "zod";

import { DeleteImagesBodySchema, DeleteImagesResponseSchema } from "@/lib/contracts/api";
import { errorJson, jsonWithSchema, zodErrorMessage } from "@/lib/http/route-response";
import { getTrashcanDirectory } from "@/lib/config-store";
import { loadVisibleRootsContext } from "@/lib/http/route-context";
import { removeCachedImageEntriesByAbsolutePath } from "@/lib/image-cache-store";
import { moveToTrash } from "@/lib/image-trash";
import { isAllowedImagePath } from "@/lib/library-scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeleteFailure = {
  path: string;
  error: string;
};

export async function DELETE(request: Request) {
  try {
    const payload = await request.json();
    const body = DeleteImagesBodySchema.parse(payload);
    const requestedPaths = Array.from(
      new Set(body.paths.map((pathValue) => pathValue.trim()).filter((pathValue) => pathValue.length > 0)),
    );
    if (requestedPaths.length === 0) {
      return errorJson("At least one image path is required.", 400);
    }

    const trashDirectory = await getTrashcanDirectory();
    if (!trashDirectory) {
      return errorJson("Trashcan directory is not configured.", 409);
    }

    const { roots } = await loadVisibleRootsContext();
    const movedPaths: string[] = [];
    const failed: DeleteFailure[] = [];

    for (const requestedPath of requestedPaths) {
      if (!isAllowedImagePath(requestedPath, roots)) {
        failed.push({ path: requestedPath, error: "Image path is not allowed." });
        continue;
      }

      let imageStats;
      try {
        imageStats = await stat(requestedPath);
      } catch {
        failed.push({ path: requestedPath, error: "Image file not found." });
        continue;
      }

      if (!imageStats.isFile()) {
        failed.push({ path: requestedPath, error: "Image path does not point to a file." });
        continue;
      }

      try {
        await moveToTrash(requestedPath, trashDirectory);
        await removeCachedImageEntriesByAbsolutePath(requestedPath);
        movedPaths.push(requestedPath);
      } catch (error) {
        failed.push({
          path: requestedPath,
          error: error instanceof Error ? error.message : "Failed to move image to trash.",
        });
      }
    }

    return jsonWithSchema(DeleteImagesResponseSchema, {
      total: requestedPaths.length,
      moved: movedPaths.length,
      movedPaths,
      failed,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid request body."), 400);
    }

    return errorJson("Failed to move selected images to trash.", 500);
  }
}
