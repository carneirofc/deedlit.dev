import { rename } from "node:fs/promises";
import path from "node:path";

import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { getImage, imageToUiDetail } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MoveBody {
  imageIds: string[];
  targetFolder: string;
}

/**
 * Bulk filesystem move — relocates image files on disk and returns per-id
 * outcomes. The catalog filepath becomes stale after a move; trigger a
 * folder re-ingest (or re-scan) at the target path to reconcile it.
 * sha256-based routes (thumbnails, vectors, search) keep working because they
 * are keyed by content hash, not path.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = (await request.json()) as MoveBody;
    const { imageIds, targetFolder } = body ?? {};

    if (!Array.isArray(imageIds) || imageIds.length === 0)
      return jsonError("imageIds required.", 400);
    if (!targetFolder?.trim()) return jsonError("targetFolder required.", 400);

    const moved: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const imageId of imageIds) {
      try {
        // Only the filepath is needed — a light catalog read (no /detail fan-out).
        const ui = imageToUiDetail(await getImage(imageId, { light: true }));
        if (!ui.filePath) {
          failed.push({ id: imageId, error: "No file path in catalog." });
          continue;
        }
        const dst = path.join(targetFolder.trim(), path.basename(ui.filePath));
        await rename(ui.filePath, dst);
        moved.push(imageId);
      } catch (e) {
        failed.push({
          id: imageId,
          error: e instanceof Error ? e.message : "Unknown error.",
        });
      }
    }

    return jsonOk({ moved, failed });
  });
}
