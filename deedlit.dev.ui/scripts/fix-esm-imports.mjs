import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DIST_DIR = fileURLToPath(new URL("../dist", import.meta.url));

function collectJsFiles(dirPath) {
  const entries = readdirSync(dirPath);
  const files = [];

  for (const entry of entries) {
    const entryPath = join(dirPath, entry);
    const stats = statSync(entryPath);

    if (stats.isDirectory()) {
      files.push(...collectJsFiles(entryPath));
      continue;
    }

    if (entryPath.endsWith(".js")) {
      files.push(entryPath);
    }
  }

  return files;
}

function appendJsExtension(specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return specifier;
  }

  if (/\.(js|mjs|cjs|json)$/.test(specifier)) {
    return specifier;
  }

  return `${specifier}.js`;
}

const files = collectJsFiles(DIST_DIR);

for (const filePath of files) {
  const source = readFileSync(filePath, "utf8");
  const updated = source
    .replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_, prefix, specifier, suffix) => {
      return `${prefix}${appendJsExtension(specifier)}${suffix}`;
    })
    .replace(/(import\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g, (_, prefix, specifier, suffix) => {
      return `${prefix}${appendJsExtension(specifier)}${suffix}`;
    });

  if (updated !== source) {
    writeFileSync(filePath, updated, "utf8");
  }
}
