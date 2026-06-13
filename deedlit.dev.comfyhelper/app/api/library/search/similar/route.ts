import { handleRoute, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { SimilarSearchRequestSchema } from "@/lib/library/schemas";
import { findSimilarImages } from "@/lib/library/services/search-service";
import { getEmbeddingProvider, hasExternalImageEmbeddings } from "@/lib/library/services/embedding-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = SimilarSearchRequestSchema.parse(await request.json());
    await ensureLibrarySchema();
    const results = await findSimilarImages(
      body.imageId,
      body.filters,
      body.limit,
      body.graphScope,
      body.minScore,
      { hnswEf: body.hnswEf, exact: body.exact },
    );
    return jsonOk({
      results,
      count: results.length,
      provider: getEmbeddingProvider(),
      // false → color/layout fallback, not learned (CLIP) similarity.
      semantic: hasExternalImageEmbeddings(),
    });
  });
}
