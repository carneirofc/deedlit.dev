import { jsonError } from "@/lib/library/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vector / similarity diagnostics for one image (the "Vector debug" panel).
 *
 * DEGRADED: this exposed raw Qdrant collection geometry, stored-vector stats
 * and per-hit payloads — all of which require direct vector-store access. The
 * deedlit.api gateway exposes no diagnostics endpoint, and comfyhelper is
 * UI-only, so this returns 501. The detail page surfaces the error inline.
 * TODO(#17): wire vector diagnostics if/when the gateway exposes them.
 */
export async function GET() {
  return jsonError("Vector debug is not available through the gateway.", 501);
}
