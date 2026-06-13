import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { browseDirectory } from "@/lib/library/services/fs-browse-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/library/fs/browse?path=<dir>
 *
 * Lists the server-side directory at `path` (or the synthetic roots view when
 * omitted) so the directory picker can navigate the filesystem to choose an
 * ingest folder.  Read-only.
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const target = new URL(request.url).searchParams.get("path");
    try {
      return jsonOk(await browseDirectory(target));
    } catch (error) {
      // Filesystem errors (missing/denied/not-a-dir) are user-correctable, so
      // surface them as 400s the picker can show inline rather than 500s.
      const message = error instanceof Error ? error.message : "Unable to read folder.";
      return jsonError(message, 400);
    }
  });
}
