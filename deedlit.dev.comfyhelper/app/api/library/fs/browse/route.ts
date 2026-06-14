import { browseFs, GatewayError } from "@/lib/api-client";
import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/library/fs/browse?path=<dir>
 *
 * Lists a directory for the admin ingest folder picker. comfyhelper is UI-only
 * and has no filesystem access, so this proxies the gateway's /fs/browse, which
 * in turn lists deedlit.ingest's host — the process whose filesystem the ingest
 * paths actually live on (#17). Omitting `path` returns the synthetic roots view.
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const target = new URL(request.url).searchParams.get("path");
    try {
      return jsonOk(await browseFs(target));
    } catch (error) {
      // The gateway returns 400 for user-correctable filesystem errors
      // (missing/denied/not-a-dir); pass those through so the picker can show
      // them inline rather than treating them as a 500.
      if (error instanceof GatewayError && error.status === 400) {
        return jsonError(error.message, 400);
      }
      throw error;
    }
  });
}
