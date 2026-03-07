const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(projectRoot, ".next", "static");
const targetDir = path.join(projectRoot, ".next", "standalone", ".next", "static");

async function copyStaticAssets() {
  await fs.promises.mkdir(targetDir, { recursive: true });
  await fs.promises.cp(sourceDir, targetDir, { recursive: true });
}

copyStaticAssets().catch((error) => {
  process.stderr.write(`Failed to copy Next.js static assets: ${error.message}\n`);
  process.exit(1);
});
