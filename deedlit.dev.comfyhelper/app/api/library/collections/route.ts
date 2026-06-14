import { handleRoute, jsonOk } from "@/lib/library/http";
import { createCollection, listCollections, type CollectionUpsert } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List collections. Proxies the gateway GET /collections (-> catalog). */
export async function GET() {
  return handleRoute(async () => {
    return jsonOk({ collections: await listCollections() });
  });
}

/** Create a collection. Proxies the gateway POST /collections (-> catalog). */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = (await request.json()) as CollectionUpsert;
    return jsonOk(await createCollection(body));
  });
}
