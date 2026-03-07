import path from "node:path";

function trimTrailingSeparator(value: string): string {
  return value.replace(/[\\\/]+$/, "");
}

function normalizeForComparison(value: string): string {
  const resolved = trimTrailingSeparator(path.resolve(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizeForComparison(candidatePath);
  const root = normalizeForComparison(rootPath);

  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}
