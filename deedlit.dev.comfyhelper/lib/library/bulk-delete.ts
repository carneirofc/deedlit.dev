/**
 * Bulk image deletion — fans the per-image un-index route
 * (`DELETE /api/library/images/{id}`) out over a list of ids with bounded
 * concurrency. That route removes the catalog record + search vector + graph
 * node (NOT the source file on disk); doing N of them is just N calls to the
 * same already-tested fan-out, so there is no bulk backend endpoint to keep in
 * sync.
 *
 * The returned promise never rejects: every id's outcome is collected so a
 * partial failure still reports which ones went away (the caller prunes those
 * from the grid) and which did not. A 404 counts as deleted — the goal state is
 * "no longer in the library", and an already-absent image satisfies it.
 */

export interface BulkDeleteOutcome {
  /** Ids that are no longer in the library (deleted now, or already gone). */
  deleted: string[];
  /** Ids that could not be removed, with the surfaced reason. */
  failed: { id: string; error: string }[];
}

export interface BulkDeleteOptions {
  /** Max in-flight deletes. Clamped to >= 1. Default 4. */
  concurrency?: number;
  signal?: AbortSignal;
}

export async function deleteImages(
  ids: string[],
  opts: BulkDeleteOptions = {},
): Promise<BulkDeleteOutcome> {
  const deleted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const queue = [...ids];

  const deleteOne = async (id: string): Promise<void> => {
    try {
      const res = await fetch(`/api/library/images/${encodeURIComponent(id)}`, {
        method: "DELETE",
        signal: opts.signal,
      });
      if (res.ok || res.status === 404) {
        deleted.push(id);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      failed.push({ id, error: body.error ?? `HTTP ${res.status}` });
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : "Request failed" });
    }
  };

  // Each worker pulls from the shared queue until it is drained. `shift()` runs
  // synchronously so workers never grab the same id.
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      await deleteOne(id);
    }
  };

  const lanes = Math.min(Math.max(1, opts.concurrency ?? 4), ids.length || 1);
  await Promise.all(Array.from({ length: lanes }, worker));

  return { deleted, failed };
}
