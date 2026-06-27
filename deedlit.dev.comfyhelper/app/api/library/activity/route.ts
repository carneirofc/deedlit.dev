import { handleRoute, jsonOk } from "@/lib/library/http";
import { getActivity, GatewayError, type ServiceActivity } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live per-service activity for the system-activity board. Proxies the gateway
 * GET /activity (which probes every service's /activity in parallel) and returns
 * `{ services, gatewayReachable, warnings }`. The board polls this on a fast
 * cadence and merges it with the slower /health poll. When the gateway is
 * unreachable, degrades to an empty list + warning so the board falls back to
 * its health-only view rather than erroring.
 */
export async function GET() {
  return handleRoute(async () => {
    try {
      const activity = await getActivity();
      const services: ServiceActivity[] = activity.services;
      return jsonOk({ services, gatewayReachable: true, warnings: [] as string[] });
    } catch (e) {
      const message = e instanceof GatewayError ? e.message : "gateway unreachable";
      return jsonOk(
        { services: [] as ServiceActivity[], gatewayReachable: false, warnings: [message] },
        { status: 503 },
      );
    }
  });
}
