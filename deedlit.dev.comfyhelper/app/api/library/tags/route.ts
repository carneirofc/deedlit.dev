import { handleRoute, jsonOk } from "@/lib/library/http";
import { suggestTags } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/library/tags?prefix=&limit=
 *
 * Tag-name autocomplete for the filter UI. Proxies the gateway GET /tags
 * (-> catalog), which returns names matching `prefix` ranked most-used first.
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const { searchParams } = new URL(request.url);
    const prefix = searchParams.get("prefix") ?? "";
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 10)));
    const tags = await suggestTags(prefix, limit);
    return jsonOk({ tags });
  });
}
