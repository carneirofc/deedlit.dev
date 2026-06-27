import { handleRoute, jsonOk } from "@/lib/library/http";
import { purgeQueue } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ name: string }> };

/** Purge all messages from a queue (destructive — the UI confirms first). */
export async function POST(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { name } = await context.params;
    await purgeQueue(name);
    return jsonOk({ status: "purged", queue: name });
  });
}
