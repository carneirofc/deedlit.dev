import { handleRoute, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { MetadataSearchRequestSchema } from "@/lib/library/schemas";
import { hybridSearch, searchImagesByMetadata } from "@/lib/library/services/search-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = MetadataSearchRequestSchema.parse(await request.json());
    await ensureLibrarySchema();
    const { query, limit, offset, graphScope, ...filters } = body;
    const results = query
      ? await hybridSearch(query, filters, limit, graphScope)
      : await searchImagesByMetadata(filters, limit, offset, graphScope);
    return jsonOk({ results, count: results.length });
  });
}
