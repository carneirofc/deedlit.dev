import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { ImageSearchOptionsSchema } from "@/lib/library/schemas";
import { buildSearchFilter, hitsToCompactResults, searchByImageUpload } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reverse-image search from a pasted/uploaded image.
 *
 * The image arrives as multipart form-data (`file`) with the JSON `options`
 * (filters / limit / minScore / graphScope) alongside — exactly what the library
 * page's image-search path posts. comfyhelper is UI-only, so it forwards the
 * upload to the gateway's POST /search/by-image, which embeds the image via
 * deedlit.vision and dense-queries deedlit.search (returning {fusion, hits}).
 *
 * graphScope is accepted for compatibility but not forwarded (the gateway has no
 * graph-scope resolution). minScore is applied client-side, mirroring the
 * similar-search route. The response shape ({results, semantic, provider}) is
 * what the page's image-mode branch consumes.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return jsonError("An image file is required.", 400);
    }

    const rawOptions = form.get("options");
    const options = ImageSearchOptionsSchema.parse(
      typeof rawOptions === "string" && rawOptions ? JSON.parse(rawOptions) : {},
    );

    const filename = file instanceof File ? file.name : "upload";
    const res = await searchByImageUpload(file, filename, {
      limit: options.limit,
      // Forward the active facet filter so reverse-image results honour the same
      // safety/tag filter as text search (the gateway translates it to a Qdrant
      // payload filter; catalog-only facets are dropped there).
      filter: buildSearchFilter(options.filters),
    });

    const raw = hitsToCompactResults(res.hits);
    // minScore is a client-side cutoff; the gateway/search has no minScore knob.
    const results =
      options.minScore > 0 ? raw.filter((r) => (r.score ?? 0) >= options.minScore) : raw;

    return jsonOk({
      results,
      count: results.length,
      // The gateway always embeds via CLIP (deedlit.vision), so by-image search
      // is always semantic here — there is no local-features fallback path.
      semantic: true,
      provider: "deedlit.vision (CLIP ViT-H-14)",
    });
  });
}
