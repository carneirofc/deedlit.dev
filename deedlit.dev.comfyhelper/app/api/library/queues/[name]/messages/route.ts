import { handleRoute, jsonOk } from "@/lib/library/http";
import { peekQueueMessages } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ name: string }> };

/**
 * Non-destructively peek a queue's messages — used to inspect the contents of
 * any task queue (live stages, .retry, and .dlq), not just dead-letters.
 * Proxies the gateway GET /queues/{name}/messages. Returns `{ messages, remaining }`.
 */
export async function GET(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { name } = await context.params;
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "20");
    const peek = await peekQueueMessages(name, Number.isFinite(limit) ? limit : 20);
    return jsonOk(peek);
  });
}
