import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, "..");
const standaloneAppRoot = path.join(projectRoot, ".next", "standalone", path.basename(projectRoot));

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyIfPresent(sourcePath, destinationPath) {
  if (!(await pathExists(sourcePath))) {
    return;
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.cp(sourcePath, destinationPath, { recursive: true, force: true });
}

async function main() {
  if (!(await pathExists(standaloneAppRoot))) {
    throw new Error(`Standalone output directory not found: ${standaloneAppRoot}`);
  }

  await copyIfPresent(
    path.join(projectRoot, ".next", "static"),
    path.join(standaloneAppRoot, ".next", "static"),
  );

  await copyIfPresent(
    path.join(projectRoot, "public"),
    path.join(standaloneAppRoot, "public"),
  );
}

main().catch((error) => {
  process.stderr.write(`Failed to prepare standalone output: ${error.message}\n`);
  process.exit(1);
});