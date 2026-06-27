import { handleRoute, jsonOk } from "@/lib/library/http";
import { listQueues } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live stats for the async task queues (index/label + their retry/dlq), proxied
 * from the gateway's RabbitMQ management proxy (#29). Returns `{ queues }`.
 */
export async function GET() {
  return handleRoute(async () => {
    const queues = await listQueues();
    return jsonOk({ queues });
  });
}
