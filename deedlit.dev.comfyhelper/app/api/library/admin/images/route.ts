import { handleRoute, jsonOk } from "@/lib/library/http";
import { listCatalogImages } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RAW catalog records for the DB power-user page (#30) — full prompt / params /
 * workflow_json / api_prompt_json, not the search CompactResult shape. Proxies
 * the gateway GET /images (catalog truth). Filterable by ?tag=&favorite=&safety=
 * &path= (path is a separator-insensitive substring match on the file path).
 * Returns `{ images }`.
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const sp = new URL(request.url).searchParams;
    const limit = Number(sp.get("limit") ?? "50");
    const offset = Number(sp.get("offset") ?? "0");
    const favoriteParam = sp.get("favorite");
    const tag = sp.get("tag")?.trim();
    const safety = sp.get("safety")?.trim();
    const path = sp.get("path")?.trim();
    const images = await listCatalogImages({
      tags: tag ? [tag] : undefined,
      safety: safety ? [safety] : undefined,
      favorite: favoriteParam === "true" ? true : undefined,
      path: path || undefined,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    return jsonOk({ images });
  });
}
