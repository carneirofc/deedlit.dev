import { handleRoute, jsonOk } from "@/lib/library/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a graph scope (hub node / related-to-image) to the image ids it
 * permits — used by the GraphFilterPanel to preview a match count and to
 * constrain searches.
 *
 * DEGRADED: the deedlit.api gateway exposes no graph-scope resolution endpoint
 * (deedlit.graph has /neighbors but the gateway only surfaces it per-image via
 * MCP, with no hub-node or scoped-id resolution). comfyhelper is UI-only and
 * may not query Neo4j directly, so graph-scoped filtering is unavailable: we
 * return an empty, unconstraining result (count 0, unsupported flag) so the
 * panel renders without breaking searches.
 * TODO(#17): wire scoped filtering once the gateway resolves graph scopes.
 */
export async function POST() {
  return handleRoute(async () =>
    jsonOk({ ids: [], count: 0, unsupported: true }),
  );
}
