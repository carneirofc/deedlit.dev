import { handleRoute, jsonOk } from "@/lib/library/http";
import { listTasks } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-image async task history from the catalog tasks ledger (#27), proxied via
 * the gateway GET /tasks. Filterable by ?sha256=&type=&status=&limit=. Returns
 * `{ tasks }`.
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const sp = new URL(request.url).searchParams;
    const limit = Number(sp.get("limit") ?? "200");
    const tasks = await listTasks({
      sha256: sp.get("sha256") ?? undefined,
      type: sp.get("type") ?? undefined,
      status: sp.get("status") ?? undefined,
      limit: Number.isFinite(limit) ? limit : 200,
    });
    return jsonOk({ tasks });
  });
}
