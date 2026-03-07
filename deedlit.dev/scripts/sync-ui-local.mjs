import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const uiRoot = path.resolve(projectRoot, "../deedlit.dev.ui");
const localUiRoot = path.resolve(projectRoot, ".ui-local");
:
mkdirSync(localUiRoot, { recursive: true });

cpSync(path.join(uiRoot, "dist"), path.join(localUiRoot, "dist"), {
  recursive: true,
  force: true
});

cpSync(
  path.join(uiRoot, "styles", "styles.css"),
  path.join(localUiRoot, "styles.css"),
  { force: true }
);

