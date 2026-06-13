import { handleRoute, jsonOk } from "@/lib/library/http";
import { getHealth, GatewayError } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Service-health dashboard. Proxies the gateway GET /health (which probes every
 * downstream service in parallel) and reshapes it into the
 * { healthy, services: { name: bool } } map the UI badges consume.
 */
export async function GET() {
  return handleRoute(async () => {
    try {
      const health = await getHealth();
      const services: Record<string, boolean> = {};
      for (const s of health.services ?? []) {
        services[s.name] = s.status === "ok";
      }
      const healthy = health.status === "ok";
      return jsonOk({ healthy, services, warnings: [] }, { status: healthy ? 200 : 503 });
    } catch (e) {
      const message = e instanceof GatewayError ? e.message : "gateway unreachable";
      return jsonOk({ healthy: false, services: { gateway: false }, warnings: [message] }, { status: 503 });
    }
  });
}
