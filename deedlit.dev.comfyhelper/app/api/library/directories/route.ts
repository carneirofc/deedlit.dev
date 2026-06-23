import { handleRoute, jsonOk } from "@/lib/library/http";
import { listDirectories } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Distinct source directories with per-directory image counts (proxies gateway
 * GET /images/directories -> catalog). Backs the library's
 * split-by-source-directory section headers — true folder totals, not just the
 * loaded page. Returns `{ directories }`; biggest folder first.
 */
export async function GET() {
  return handleRoute(async () => {
    const directories = await listDirectories();
    return jsonOk({ directories });
  });
}
