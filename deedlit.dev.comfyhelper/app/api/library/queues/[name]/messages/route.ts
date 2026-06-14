import { handleRoute, jsonOk } from "@/lib/library/http";
import { peekQueueMessages } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ name: string }> };

/**
 * Non-destructively peek a queue's messages (used to inspect DLQ contents).
 * Proxies the gateway GET /queues/{name}/messages. Returns `{ messages }`.
 */
export async function GET(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { name } = await context.params;
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "20");
    const messages = await peekQueueMessages(name, Number.isFinite(limit) ? limit : 20);
    return jsonOk({ messages });
  });
}
