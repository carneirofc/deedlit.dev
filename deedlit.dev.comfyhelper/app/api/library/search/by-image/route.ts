import { jsonError } from "@/lib/library/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reverse-image search from a pasted/uploaded image.
 *
 * DEGRADED: this requires embedding raw image bytes and querying the vector
 * store with the resulting vector. The deedlit.api gateway exposes no
 * image-upload search path (deedlit.search /by-image takes a *stored* sha256,
 * and the gateway does not surface it). comfyhelper is UI-only and may not call
 * deedlit.vision / deedlit.search directly, so this returns 501 until the
 * gateway adds an upload-search endpoint.
 * TODO(#17): wire reverse-image search once the gateway exposes upload search.
 */
export async function POST() {
  return jsonError(
    "Reverse-image search is not available: the gateway exposes no image-upload search endpoint.",
    501,
  );
}
