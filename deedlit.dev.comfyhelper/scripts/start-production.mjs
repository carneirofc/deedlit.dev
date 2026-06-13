import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

// PostgreSQL is the canonical store; its schema is ensured lazily on first API
// call (see lib/library/db/migrate.ts), so production start is just `next start`.
const requireFromModule = createRequire(import.meta.url);
const nextCliPath = requireFromModule.resolve("next/dist/bin/next");

const result = spawnSync(process.execPath, [nextCliPath, "start", ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 0);
