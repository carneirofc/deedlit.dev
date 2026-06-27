import { handleRoute, jsonOk } from "@/lib/library/http";
import { ExportRequestSchema } from "@/lib/library/schemas";
import { getImage, GatewayError, type CatalogImage } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bulk export the canonical catalog records for a set of selected images. Fans
 * the gateway GET /images/{sha256} (a pure catalog read — NOT the /detail
 * fan-out, so no unused search /similar + graph /neighbors per id) out over the
 * id list with bounded concurrency and returns each image's RAW catalog record —
 * the same shape the API serves (contracts/catalog.openapi.yaml), NOT the lossy
 * UI detail subset — so the dump round-trips against the contract. There is no
 * bulk detail endpoint downstream, so this is just N gateway reads; per-id
 * failures are collected in `errors` so a partial export still returns whatever
 * resolved.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const { ids } = ExportRequestSchema.parse(await request.json());

    const images: CatalogImage[] = [];
    const errors: { id: string; error: string }[] = [];
    const queue = [...ids];

    const fetchOne = async (id: string): Promise<void> => {
      try {
        images.push(await getImage(id));
      } catch (e) {
        if (e instanceof GatewayError && e.status === 404) {
          errors.push({ id, error: "Image not found." });
          return;
        }
        errors.push({ id, error: e instanceof Error ? e.message : "Request failed" });
      }
    };

    // Each lane drains the shared queue; `shift()` is synchronous so no id is
    // claimed twice. Lanes are capped so a big selection can't fan a flood of
    // concurrent reads at the gateway.
    const worker = async (): Promise<void> => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        await fetchOne(id);
      }
    };
    const lanes = Math.min(6, ids.length);
    await Promise.all(Array.from({ length: lanes }, worker));

    return jsonOk({
      exportedAt: new Date().toISOString(),
      requested: ids.length,
      count: images.length,
      images,
      errors,
    });
  });
}
