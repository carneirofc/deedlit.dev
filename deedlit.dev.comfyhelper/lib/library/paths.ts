/**
 * Helpers for the server-side filesystem paths users set as ingestion sources.
 *
 * The ingest host can be Windows (`K:\comfyui\output`) or POSIX
 * (`/mnt/data/output`), so these MUST NOT convert separators — doing so would
 * corrupt a perfectly valid path on the other platform. We only tidy a path
 * (trim, collapse accidental doubled separators, drop a trailing separator) and
 * *warn* about a mixed-separator path rather than rewriting it.
 *
 * Kept dependency-free and React-free so it is trivially unit-testable
 * (tests/unit/paths.unit.ts) and reusable by both the admin one-shot ingest and
 * the source-folder registry panel.
 */

/** Image extensions ingest will actually catalog (mirrors metadata-service). */
export const IMAGE_EXTENSIONS = new Set([".png", ".webp", ".jpg", ".jpeg"]);

/** True when a directory-listing entry name is an ingestable image. */
export function isImageFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/**
 * Tidy a single path without changing which file it points at:
 *  - trim surrounding whitespace
 *  - collapse runs of the same separator (`a//b` → `a/b`, `a\\\\b` → `a\b`),
 *    preserving a leading UNC (`\\`) or POSIX network (`//`) prefix
 *  - strip a trailing separator, except for a bare root (`/`) or a Windows
 *    drive root (`C:\`)
 * Separators are never swapped, so a POSIX path stays POSIX and vice-versa.
 */
export function normalizePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const leadMatch = /^(\\\\|\/\/)/.exec(trimmed);
  const lead = leadMatch ? leadMatch[0] : "";
  let body = trimmed.slice(lead.length);

  body = body.replace(/\/{2,}/g, "/").replace(/\\{2,}/g, "\\");

  // Keep `C:` / `C:\` / `C:/` and bare roots intact; otherwise drop trailing sep.
  if (!/^[A-Za-z]:[\\/]?$/.test(body) && body.length > 1) {
    body = body.replace(/[\\/]+$/, "");
  }

  return lead + body;
}

/** Lower-cased normalized form, for case-insensitive comparison/dedupe. */
export function pathKey(path: string): string {
  return normalizePath(path).toLowerCase();
}

/**
 * Split a multi-line blob (one path per line) into normalized, de-duplicated
 * paths in input order. Blank lines are dropped. Backs the "add multiple
 * folders" textarea.
 */
export function splitPaths(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const norm = normalizePath(line);
    if (!norm) continue;
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

/** True when `path` already exists in `existing` (normalized, case-insensitive). */
export function isAlreadyConfigured(path: string, existing: readonly string[]): boolean {
  const key = pathKey(path);
  if (!key) return false;
  return existing.some((e) => pathKey(e) === key);
}

/**
 * True when a path mixes `\` and `/` (e.g. `K:\comfyui/output`) — usually a
 * paste/typo. The leading UNC/POSIX-network prefix is ignored so a genuine
 * `\\server\share` does not falsely flag.
 */
export function hasMixedSeparators(path: string): boolean {
  const body = path.replace(/^(\\\\|\/\/)/, "");
  return body.includes("\\") && body.includes("/");
}
