import { handleRoute, jsonOk } from "@/lib/library/http";
import { getHealth, GatewayError, type ServiceHealth } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ComponentStatus = "ok" | "degraded" | "down";

interface Dependency {
  name: string;
  ready: boolean;
}

interface ComponentHealth {
  name: string;
  status: ComponentStatus;
  dependencies: Dependency[];
}

/**
 * Maps a downstream readiness flag (as forwarded by the gateway in
 * ServiceHealth.detail) to the human-facing datastore/dependency it represents.
 * Anything not listed here is surfaced under its raw key so new flags still show
 * up without a code change.
 */
const DEP_LABELS: Record<string, string> = {
  db_ready: "PostgreSQL",
  blob_ready: "RustFS",
  collection_ready: "Qdrant",
  neo4j_ready: "Neo4j",
  vision_ready: "CLIP model",
  text_ready: "Text encoder",
  sparse_ready: "SPLADE model",
};

/** Pull the boolean `*_ready` flags out of a service's detail into dependency rows. */
function dependencies(detail: ServiceHealth["detail"]): Dependency[] {
  if (!detail) return [];
  const deps: Dependency[] = [];
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value !== "boolean") continue;
    deps.push({ name: DEP_LABELS[key] ?? key, ready: value });
  }
  return deps;
}

/**
 * Service-status dashboard. Proxies the gateway GET /health (which probes every
 * downstream service in parallel) and reshapes it into:
 *   - `components`: the rich per-service view the status board renders (status +
 *     dependency readiness rows), with the gateway itself as the first entry.
 *   - `services`:   the flat { name: bool } map the library header badges consume.
 * When the gateway itself is unreachable, every component is reported down.
 */
export async function GET() {
  return handleRoute(async () => {
    const checkedAt = new Date().toISOString();
    try {
      const health = await getHealth();
      const upstream = health.services ?? [];

      const components: ComponentHealth[] = [
        // The gateway answered, so it is up by definition.
        { name: "gateway", status: "ok", dependencies: [] },
        ...upstream.map((s) => ({
          name: s.name,
          status: s.status,
          dependencies: dependencies(s.detail),
        })),
      ];

      const services: Record<string, boolean> = {};
      for (const s of upstream) services[s.name] = s.status === "ok";

      const healthy = health.status === "ok";
      return jsonOk(
        { healthy, status: health.status, gatewayReachable: true, checkedAt, components, services, warnings: [] },
        { status: healthy ? 200 : 503 },
      );
    } catch (e) {
      const message = e instanceof GatewayError ? e.message : "gateway unreachable";
      return jsonOk(
        {
          healthy: false,
          status: "down" as const,
          gatewayReachable: false,
          checkedAt,
          components: [{ name: "gateway", status: "down" as const, dependencies: [] }],
          services: { gateway: false },
          warnings: [message],
        },
        { status: 503 },
      );
    }
  });
}
