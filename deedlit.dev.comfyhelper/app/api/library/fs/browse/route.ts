import { jsonError } from "@/lib/library/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side directory listing for the ingest folder picker.
 *
 * DEGRADED: this listed the host filesystem of the monolith. comfyhelper is now
 * UI-only and runs nowhere near the ingest worker's filesystem, and the gateway
 * exposes no fs-browse endpoint. The picker falls back to manual path entry.
 * TODO(#17): wire a folder picker against deedlit.ingest's host if needed.
 */
export async function GET() {
  return jsonError("Folder browsing is not available; type the ingest path manually.", 501);
}
