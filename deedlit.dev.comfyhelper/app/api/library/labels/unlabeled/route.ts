import { handleRoute, jsonOk } from "@/lib/library/http";
import { listUnlabeled } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Library-wide labeling coverage: how many cataloged images still have no AI
 * label/description (the work set the "Backfill labels" action fills). Returns
 * `{ unlabeled, sha256 }` — the count drives the admin readout; the ids are
 * available for drill-down.
 */
export async function GET() {
  return handleRoute(async () => {
    const sha256 = await listUnlabeled();
    return jsonOk({ unlabeled: sha256.length, sha256 });
  });
}
