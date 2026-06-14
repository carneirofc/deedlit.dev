import { handleRoute, jsonOk } from "@/lib/library/http";
import { listJobs } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Coerce an opaque value into a `{ stage: count }` map (drops non-numeric). */
function stageCounts(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/**
 * List ingest/maintenance jobs for the dashboard. Proxies the gateway GET /jobs
 * (-> deedlit.ingest) and normalizes each opaque job into the fields the UI
 * renders, tolerating shape drift from the ingest service.
 */
export async function GET() {
  return handleRoute(async () => {
    const raw = await listJobs();
    const jobs = raw.map((j) => ({
      id: strOrNull(j.id) ?? strOrNull(j.job_id) ?? "",
      folderPath: strOrNull(j.folderPath) ?? strOrNull(j.folder_path),
      status: strOrNull(j.status) ?? "unknown",
      totalFiles: num(j.totalFiles ?? j.total_files),
      processedFiles: num(j.processedFiles ?? j.processed_files),
      failedFiles: num(j.failedFiles ?? j.failed_files),
      errorMessage: strOrNull(j.errorMessage ?? j.error_message),
      startedAt: strOrNull(j.startedAt ?? j.started_at),
      finishedAt: strOrNull(j.finishedAt ?? j.finished_at),
      createdAt: strOrNull(j.createdAt ?? j.created_at) ?? "",
      // Live pipeline stage + per-stage staircase (which service is active now).
      stage: strOrNull(j.currentStage ?? j.current_stage ?? j.stage),
      stageCounts: stageCounts(j.stageCounts ?? j.stage_counts),
    }));
    return jsonOk({ jobs });
  });
}
