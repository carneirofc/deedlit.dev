import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { getImageDetail } from "@/lib/library/repositories/image-repository";
import { debugSimilarImages } from "@/lib/library/services/search-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null ? NaN : parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Similarity diagnostics for one image: the health of its stored embedding,
 * the live collection geometry, the active embedder, and its nearest neighbors
 * with raw scores + payloads. Powers the "Vector debug" panel on the detail
 * page so an off ranking can be traced to local-fallback / dim-mismatch /
 * poisoned-vector causes.
 *
 * Query params: ?limit=12&minScore=0&hnswEf=128&exact=false
 */
export async function GET(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;
    await ensureLibrarySchema();

    const detail = await getImageDetail(imageId);
    if (!detail) return jsonError("Image not found.", 404);

    const url = new URL(request.url);
    const limit = clampInt(url.searchParams.get("limit"), 12, 1, 100);
    const minScoreRaw = parseFloat(url.searchParams.get("minScore") ?? "");
    const minScore = Number.isFinite(minScoreRaw) ? Math.min(1, Math.max(0, minScoreRaw)) : 0;
    const hnswEf = clampInt(url.searchParams.get("hnswEf"), 128, 4, 1024);
    const exact = url.searchParams.get("exact") === "true";

    const explain = await debugSimilarImages(imageId, undefined, limit, { minScore, hnswEf, exact });
    return jsonOk(explain);
  });
}
