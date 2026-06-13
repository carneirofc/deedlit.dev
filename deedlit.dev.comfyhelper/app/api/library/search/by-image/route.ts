import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { ImageSearchOptionsSchema } from "@/lib/library/schemas";
import { searchByExternalImage } from "@/lib/library/services/search-service";
import { getEmbeddingProvider, hasExternalImageEmbeddings } from "@/lib/library/services/embedding-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Reverse-image search.  Accepts multipart form-data with a `file` (the pasted
 * or uploaded image, never persisted) and an optional `options` JSON string
 * carrying filters / limit / minScore.  The image is embedded in-memory and
 * matched against the Qdrant collection.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const form = await request.formData();

    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return jsonError("Expected an image in the 'file' field.", 400);
    }
    if (file.size === 0) return jsonError("Empty image file.", 400);
    if (file.size > MAX_BYTES) return jsonError("Image too large (max 20 MB).", 413);

    const rawOptions = form.get("options");
    const options = ImageSearchOptionsSchema.parse(
      rawOptions ? JSON.parse(String(rawOptions)) : {},
    );

    await ensureLibrarySchema();

    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "image/png";
    const results = await searchByExternalImage(
      buffer,
      mime,
      options.filters,
      options.limit,
      options.minScore,
      options.graphScope,
    );

    return jsonOk({
      results,
      count: results.length,
      provider: getEmbeddingProvider(),
      // false → matched on the local color/layout fallback (CLIP not configured)
      semantic: hasExternalImageEmbeddings(),
    });
  });
}
