import { handleRoute, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { SemanticSearchRequestSchema } from "@/lib/library/schemas";
import { semanticImageSearch } from "@/lib/library/services/search-service";
import { getEmbeddingProvider, hasExternalImageEmbeddings } from "@/lib/library/services/embedding-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = SemanticSearchRequestSchema.parse(await request.json());
    await ensureLibrarySchema();
    const results = await semanticImageSearch(body.query, body.filters, body.limit, body.minScore);
    return jsonOk({
      results,
      count: results.length,
      provider: getEmbeddingProvider(),
      // false → no CLIP text tower, so this fell back to PostgreSQL metadata search.
      semantic: hasExternalImageEmbeddings(),
    });
  });
}
