import { maybeRow, rows } from "@/lib/library/db/postgres";

export interface JobSummary {
  id: string;
  folderPath: string | null;
  status: string;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface JobRow {
  id: string;
  folder_path: string | null;
  status: string;
  total_files: number;
  processed_files: number;
  failed_files: number;
  error_message: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

function toSummary(r: JobRow): JobSummary {
  return {
    id: r.id,
    folderPath: r.folder_path,
    status: r.status,
    totalFiles: r.total_files,
    processedFiles: r.processed_files,
    failedFiles: r.failed_files,
    errorMessage: r.error_message,
    startedAt: r.started_at ? r.started_at.toISOString() : null,
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

export async function listJobs(limit = 50): Promise<JobSummary[]> {
  const result = await rows<JobRow>(
    `SELECT * FROM ingestion_jobs ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.map(toSummary);
}

export async function getJob(jobId: string): Promise<{ job: JobSummary; failedFiles: Array<{ filePath: string; error: string | null }> } | null> {
  const row = await maybeRow<JobRow>(`SELECT * FROM ingestion_jobs WHERE id = $1`, [jobId]);
  if (!row) return null;
  const failed = await rows<{ file_path: string; error: string | null }>(
    `SELECT file_path, error FROM ingestion_job_files WHERE job_id = $1 AND status = 'failed' LIMIT 200`,
    [jobId],
  );
  return {
    job: toSummary(row),
    failedFiles: failed.map((f) => ({ filePath: f.file_path, error: f.error })),
  };
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const row = await maybeRow<{ id: string }>(
    `UPDATE ingestion_jobs SET status='cancelled', finished_at=now()
      WHERE id=$1 AND status IN ('pending','running') RETURNING id`,
    [jobId],
  );
  return row !== null;
}
