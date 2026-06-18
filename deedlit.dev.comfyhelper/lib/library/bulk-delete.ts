/**
 * Bulk image deletion — un-indexes a list of images in ONE batch call to
 * `POST /api/library/images/batch-delete`, which proxies the gateway batch
 * endpoint (catalog record + search vector + graph node per id — NOT the source
 * file on disk). The gateway does a single batch op per store, so deleting N
 * images is a handful of DB round-trips, not N×3.
 *
 * The returned promise never rejects: a transport / non-2xx error maps every id
 * to `failed` (so the caller can surface it), while a success splits the ids into
 * the ones that went away and any the server reports as not-deleted. A `missing`
 * id (already absent) counts as deleted — the goal state is "no longer in the
 * library", which an already-gone image satisfies.
 */

export interface BulkDeleteOutcome {
  /** Ids that are no longer in the library (deleted now, or already gone). */
  deleted: string[];
  /** Ids that could not be removed, with the surfaced reason. */
  failed: { id: string; error: string }[];
}

export interface BulkDeleteOptions {
  signal?: AbortSignal;
}

export async function deleteImages(
  ids: string[],
  opts: BulkDeleteOptions = {},
): Promise<BulkDeleteOutcome> {
  if (ids.length === 0) return { deleted: [], failed: [] };

  const fail = (error: string): BulkDeleteOutcome => ({
    deleted: [],
    failed: ids.map((id) => ({ id, error })),
  });

  try {
    const res = await fetch("/api/library/images/batch-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return fail(body.error ?? `HTTP ${res.status}`);
    }
    const j = (await res.json()) as { deleted?: string[]; missing?: string[] };
    // `missing` (already absent) satisfies the goal state, so count it as deleted.
    const deleted = [...(j.deleted ?? []), ...(j.missing ?? [])];
    const gone = new Set(deleted);
    const failed = ids
      .filter((id) => !gone.has(id))
      .map((id) => ({ id, error: "not deleted" }));
    return { deleted, failed };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Request failed");
  }
}
