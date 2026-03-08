const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const standaloneRoot = path.join(projectRoot, ".next", "standalone", "deedlit.dev");
const staticSourceDir = path.join(projectRoot, ".next", "static");
const staticTargetDir = path.join(standaloneRoot, ".next", "static");
const publicSourceDir = path.join(projectRoot, "public");
const publicTargetDir = path.join(standaloneRoot, "public");

async function copyStaticAssets() {
  await fs.promises.mkdir(staticTargetDir, { recursive: true });
  await fs.promises.cp(staticSourceDir, staticTargetDir, { recursive: true });

  if (fs.existsSync(publicSourceDir)) {
    await fs.promises.mkdir(publicTargetDir, { recursive: true });
    await fs.promises.cp(publicSourceDir, publicTargetDir, { recursive: true });
  }
}

copyStaticAssets().catch((error) => {
  process.stderr.write(`Failed to copy Next.js static assets: ${error.message}\n`);
  process.exit(1);
});
