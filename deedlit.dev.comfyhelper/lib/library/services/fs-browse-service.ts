import { access, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Server-side filesystem browser backing the directory picker in the admin /
 * library ingest UIs.  Ingestion runs on the server and needs an *absolute*
 * filesystem path (e.g. `K:/comfyui/output`); a browser file input cannot
 * produce one, so the UI navigates the server's filesystem through this
 * service instead.
 *
 * This intentionally exposes the whole filesystem — it mirrors the trust model
 * already established by `ingest-service`, which happily walks any path the
 * caller provides.  It is read-only (directory listing only).
 */

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface FsRoot {
  label: string;
  path: string;
}

export interface FsBrowseResult {
  /** Absolute path being listed, or null for the synthetic "roots" view. */
  path: string | null;
  /** Parent directory, or null when already at a drive/filesystem root. */
  parent: string | null;
  separator: string;
  entries: FsEntry[];
  /** Quick-access jump targets (drives, home, app dir) shown in every view. */
  roots: FsRoot[];
}

/** Cap listing size so pathological directories cannot bloat the response. */
const MAX_ENTRIES = 2000;

/**
 * Probe drive letters C..Z on Windows.  A: and B: are skipped on purpose —
 * legacy floppy letters can stall the probe for seconds when no media exists.
 */
async function listWindowsDrives(): Promise<FsRoot[]> {
  const letters = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const found = await Promise.all(
    letters.map(async (letter) => {
      const root = `${letter}:\\`;
      try {
        await access(root);
        return root;
      } catch {
        return null;
      }
    }),
  );
  return found
    .filter((root): root is string => root !== null)
    .map((root) => ({ label: root, path: root }));
}

async function quickRoots(): Promise<FsRoot[]> {
  const roots: FsRoot[] = [];
  if (process.platform === "win32") {
    roots.push(...(await listWindowsDrives()));
  } else {
    roots.push({ label: "/", path: "/" });
  }
  const home = os.homedir();
  if (home) roots.push({ label: "Home", path: home });
  roots.push({ label: "App dir", path: process.cwd() });

  const seen = new Set<string>();
  return roots.filter((root) => {
    if (seen.has(root.path)) return false;
    seen.add(root.path);
    return true;
  });
}

function friendlyFsError(error: unknown, target: string): Error {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case "ENOENT":
      return new Error(`Folder not found: ${target}`);
    case "ENOTDIR":
      return new Error(`Not a folder: ${target}`);
    case "EACCES":
    case "EPERM":
      return new Error(`Permission denied: ${target}`);
    default:
      return new Error(error instanceof Error ? error.message : `Cannot open ${target}`);
  }
}

/**
 * List the directory at `input`.  Passing null/empty returns the synthetic
 * roots view (drive letters on Windows, `/` on POSIX, plus home & app dir).
 */
export async function browseDirectory(input: string | null): Promise<FsBrowseResult> {
  const roots = await quickRoots();

  if (!input || input.trim() === "") {
    return {
      path: null,
      parent: null,
      separator: path.sep,
      entries: roots.map((root) => ({ name: root.label, path: root.path, isDirectory: true })),
      roots,
    };
  }

  const resolved = path.resolve(input.trim());

  let dirents;
  try {
    dirents = await readdir(resolved, { withFileTypes: true });
  } catch (error) {
    throw friendlyFsError(error, resolved);
  }

  const entries: FsEntry[] = [];
  for (const dirent of dirents) {
    entries.push({
      name: dirent.name,
      path: path.join(resolved, dirent.name),
      isDirectory: dirent.isDirectory(),
    });
    if (entries.length >= MAX_ENTRIES) break;
  }

  // Directories first, then files; case-insensitive alphabetical within each.
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  const parentDir = path.dirname(resolved);
  const parent = parentDir === resolved ? null : parentDir;

  return { path: resolved, parent, separator: path.sep, entries, roots };
}
