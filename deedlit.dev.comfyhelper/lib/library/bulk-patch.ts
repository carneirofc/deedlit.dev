/**
 * Bulk metadata edit — fans the per-image PATCH route
 * (`PATCH /api/library/images/{id}`) out over a list of per-image bodies with
 * bounded concurrency. That route proxies the gateway PATCH /images/{sha}
 * (catalog truth: rating / favorite / tags / safety), so a bulk edit is just N
 * calls to the same already-tested endpoint — no bulk backend to keep in sync.
 *
 * Bodies are per-id (not one shared body) so tag add/remove can be expressed as
 * a computed final tag list per image (the catalog PATCH replaces the whole tag
 * set). The returned promise never rejects: every id's outcome is collected so a
 * partial failure still reports which images changed (the caller updates those
 * grid rows) and which did not.
 */

import type { ImagePatchBody } from "@/lib/api-client";

export interface BulkPatchOutcome {
  /** Ids whose catalog record was updated. */
  updated: string[];
  /** Ids that could not be updated, with the surfaced reason. */
  failed: { id: string; error: string }[];
}

export interface BulkPatchOptions {
  /** Max in-flight patches. Clamped to >= 1. Default 4. */
  concurrency?: number;
  signal?: AbortSignal;
}

export async function patchImages(
  patches: { id: string; body: ImagePatchBody }[],
  opts: BulkPatchOptions = {},
): Promise<BulkPatchOutcome> {
  const updated: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const queue = [...patches];

  const patchOne = async (p: { id: string; body: ImagePatchBody }): Promise<void> => {
    try {
      const res = await fetch(`/api/library/images/${encodeURIComponent(p.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p.body),
        signal: opts.signal,
      });
      if (res.ok) {
        updated.push(p.id);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      failed.push({ id: p.id, error: body.error ?? `HTTP ${res.status}` });
    } catch (e) {
      failed.push({ id: p.id, error: e instanceof Error ? e.message : "Request failed" });
    }
  };

  // Each worker drains the shared queue; `shift()` is synchronous so no id is
  // patched twice.
  const worker = async (): Promise<void> => {
    for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
      await patchOne(p);
    }
  };
  const lanes = Math.min(Math.max(1, opts.concurrency ?? 4), patches.length || 1);
  await Promise.all(Array.from({ length: lanes }, worker));

  return { updated, failed };
}
