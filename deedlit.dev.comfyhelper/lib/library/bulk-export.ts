/**
 * Bulk export — POST the selected ids to `/api/library/export` (which fans the
 * gateway detail reads out server-side) and download the returned canonical
 * catalog records as a JSON file. Mirrors bulk-delete in spirit: one user
 * action over a selection, tolerant of partial failure (the route reports which
 * ids resolved and which did not).
 */

import type { CatalogImage } from "@/lib/api-client";

/**
 * The chosen export flavour. `complete-*` dump the full canonical catalog record
 * (round-trips against the contract); `simple-*` keep only the basic, human-
 * scannable fields — enough to identify and locate an image. CSV is simple-only
 * (the full record is too nested to flatten into a table sensibly).
 */
export type ExportKind =
  | "complete-json"
  | "complete-jsonl"
  | "simple-json"
  | "simple-jsonl"
  | "simple-csv";

export interface BulkExportResult {
  exportedAt: string;
  /** How many ids were requested. */
  requested: number;
  /** How many records actually resolved (`images.length`). */
  count: number;
  images: CatalogImage[];
  /** Ids that could not be exported, with the surfaced reason. */
  errors: { id: string; error: string }[];
}

export async function exportImages(ids: string[], signal?: AbortSignal): Promise<BulkExportResult> {
  const res = await fetch("/api/library/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as Partial<BulkExportResult> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Export failed (HTTP ${res.status})`);
  return {
    exportedAt: body.exportedAt ?? new Date().toISOString(),
    requested: body.requested ?? ids.length,
    count: body.count ?? body.images?.length ?? 0,
    images: body.images ?? [],
    errors: body.errors ?? [],
  };
}

/**
 * The basic, human-scannable subset kept in a "simple" export: enough to
 * identify (id / sha256), locate (file path + name) and triage (dimensions,
 * rating, favorite, safety, source tool, tags, date) an image — without the
 * full canonical record's prompts, params, workflow JSON and references.
 */
export interface SimpleExportRecord {
  /** Catalog id — the sha256 (kept under `id` too for convenience). */
  id: string;
  sha256: string;
  filePath: string | null;
  filename: string | null;
  width: number | null;
  height: number | null;
  rating: number | null;
  favorite: boolean;
  safety: string | null;
  sourceTool: string | null;
  createdAt: string | null;
  tags: string[];
}

/** Project a full canonical catalog record down to the simple export subset. */
export function toSimpleRecord(image: CatalogImage): SimpleExportRecord {
  // The contract spells it `filepath`; tolerate a camelCase forward too.
  const filePath =
    (image.filepath as string | null | undefined) ??
    (image.filePath as string | null | undefined) ??
    null;
  return {
    id: image.sha256,
    sha256: image.sha256,
    filePath: filePath ?? null,
    filename: filePath ? filePath.split(/[\\/]/).pop() ?? null : null,
    width: image.width ?? null,
    height: image.height ?? null,
    rating: image.rating ?? null,
    favorite: image.favorite ?? false,
    safety: (image.safety as string | null | undefined) ?? null,
    sourceTool: image.sourceTool ?? null,
    createdAt: image.created_at ?? null,
    tags: image.tags ?? [],
  };
}

/** Trigger a client-side download of `text` as a file with the given mime type. */
export function downloadText(text: string, filename: string, type = "text/plain"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Trigger a client-side download of `data` as a pretty-printed JSON file. */
export function downloadJson(data: unknown, filename: string): void {
  downloadText(JSON.stringify(data, null, 2), filename, "application/json");
}

/**
 * Trigger a download of `images` as JSON Lines (one record per line, NDJSON) —
 * a stream-friendly form of the same canonical catalog records, handy for
 * piping into jq / bulk re-import. Carries the records only (no export wrapper).
 */
export function downloadJsonl(images: unknown[], filename: string): void {
  const text = images.map((img) => JSON.stringify(img)).join("\n") + "\n";
  downloadText(text, filename, "application/x-ndjson");
}

/**
 * Trigger a download of `rows` as CSV. Columns are the keys of the first row;
 * array cells join on "; "; values with commas/quotes/newlines are quoted with
 * RFC-4180 doubling. Meant for the flat simple-export records — a spreadsheet-
 * friendly table of the basics.
 */
export function downloadCsv(rows: readonly object[], filename: string): void {
  if (rows.length === 0) {
    downloadText("", filename, "text/csv");
    return;
  }
  const headers = Object.keys(rows[0]);
  const cell = (v: unknown): string => {
    const s = Array.isArray(v) ? v.join("; ") : v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => cell((r as Record<string, unknown>)[h])).join(",")),
  ];
  downloadText(lines.join("\n") + "\n", filename, "text/csv");
}
