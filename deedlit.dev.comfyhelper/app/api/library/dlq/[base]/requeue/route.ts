import { handleRoute, jsonOk } from "@/lib/library/http";
import { requeueDlq } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ base: string }> };

/**
 * Requeue a base queue's DLQ (index|label) back to the main queue — the in-app
 * "retry failed" action. Proxies the gateway POST /dlq/{base}/requeue.
 */
export async function POST(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { base } = await context.params;
    const res = await requeueDlq(base);
    return jsonOk({ status: "requeued", queue: base, count: res.count ?? 0 });
  });
}
