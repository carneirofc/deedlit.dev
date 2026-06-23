import { handleRoute, jsonOk } from "@/lib/library/http";
import { suggestGraphEntities } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/library/graph/entities?type=&prefix=&limit=
 *
 * Graph entity-name autocomplete for the GraphFilterPanel value picker. Proxies
 * the gateway GET /graph/entities (-> deedlit.graph), which returns the names of
 * :Tag / :Asset nodes of the given `type` matching `prefix`, most-used first. An
 * absent/blank `type` yields an empty list (nothing to suggest yet).
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const { searchParams } = new URL(request.url);
    const type = (searchParams.get("type") ?? "").trim();
    const prefix = searchParams.get("prefix") ?? "";
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const entities = type ? await suggestGraphEntities(type, prefix, limit) : [];
    return jsonOk({ entities });
  });
}
