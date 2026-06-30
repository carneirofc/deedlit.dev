import { handleRoute, jsonOk } from "@/lib/library/http";
import { findMissingFiles } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scan the catalog for images whose on-disk source file vanished. Proxies the
 * gateway GET /maintenance/missing-files (routed to deedlit.ingest, the host-FS
 * owner). Read-only — the admin reviews the orphaned entries, then cleans them up
 * via the existing batch-delete. `?limit=` caps the returned list (default 500).
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const sp = new URL(request.url).searchParams;
    const limit = Number(sp.get("limit") ?? "500");
    return jsonOk(await findMissingFiles(Number.isFinite(limit) ? limit : 500));
  });
}
