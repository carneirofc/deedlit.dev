import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { batchDeleteImages } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bulk un-index images in ONE call. Proxies the gateway POST /images/batch-delete
 * (catalog record + search vector + graph node per id — NOT the source files on
 * disk), which does a single batch op per store instead of N per-image deletes.
 * Body: `{ ids: string[] }` (sha256s); capped at 1000.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    if (ids.length === 0) return jsonError("no image ids provided", 400);
    if (ids.length > 1000) return jsonError("too many ids (max 1000)", 400);
    return jsonOk(await batchDeleteImages(ids));
  });
}
