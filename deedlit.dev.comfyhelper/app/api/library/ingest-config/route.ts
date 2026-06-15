import { handleRoute, jsonOk } from "@/lib/library/http";
import { getIngestConfig, updateIngestConfig, type IngestConfig } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live ingest producer config (ADR 0002) — folder-scan parallelism, proxied
 * from the gateway (-> deedlit.ingest /config). Backs the settings panel's
 * "Ingest & indexing" section. GET reads the effective config; PUT patches it.
 */
export async function GET() {
  return handleRoute(async () => jsonOk(await getIngestConfig()));
}

export async function PUT(req: Request) {
  return handleRoute(async () => {
    const body = (await req.json().catch(() => ({}))) as Partial<IngestConfig>;
    const patch: Partial<IngestConfig> = {};
    if (typeof body.ingest_concurrency === "number") {
      patch.ingest_concurrency = body.ingest_concurrency;
    }
    if (typeof body.ingest_via_queue === "boolean") {
      patch.ingest_via_queue = body.ingest_via_queue;
    }
    return jsonOk(await updateIngestConfig(patch));
  });
}
