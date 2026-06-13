import { handleRoute, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { rescanFiles } from "@/lib/library/services/maintenance-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return handleRoute(async () => {
    await ensureLibrarySchema();
    return jsonOk(await rescanFiles());
  });
}
