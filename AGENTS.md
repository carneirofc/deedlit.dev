# Deedlit Monorepo Agent Guide

## Start Here
- The repo root is a workspace orchestrator, not the primary home of application logic.
- Check `package.json` at the repo root for workspace-level commands, then move into the package that owns the task.
- Read the nearest package-local `.github/copilot-instructions.md` before editing code.

## Toolchain & Environment (Windows / PowerShell)
Don't go hunting for these every session — they are version-managed, not on the bare PATH.

### Node — managed by **fnm**
- `fnm.exe`: `C:\Users\claud\AppData\Local\Microsoft\WinGet\Links\fnm.exe` (already on PATH).
- `FNM_DIR`: `C:\Users\claud\AppData\Roaming\fnm`; installed versions live under `…\fnm\node-versions\`.
- Default/active version: **v24.13.1** (`node` resolves into an fnm multishell, not a fixed path).
- Activate in a PowerShell session (the Bash/PowerShell tool does NOT auto-load fnm):
  ```powershell
  fnm env --use-on-cd | Out-String | Invoke-Expression
  ```
  After that, `node`, `npm`, `npx` work. `--use-on-cd` makes fnm honor a repo's `.node-version`/`.nvmrc` on entry. Use `npm` for workspace scripts (see Command Reference).

### Python — managed by **uv**, per-package venvs
- `uv.exe`: `C:\Users\claud\.local\bin\uv.exe` (on PATH).
- ⚠️ Bare `python` on PATH is the **Windows Store stub** (`…\WindowsApps\python.exe`) — do not use it.
- `deedlit.vision/` has its own venv: `deedlit.vision\.venv` (**Python 3.14.5**).
  - Activate: `deedlit.vision\.venv\Scripts\Activate.ps1`
  - Or run without activating: `uv run --project deedlit.vision <cmd>` (or `cd deedlit.vision; uv run <cmd>`).
- To get a python without a venv: `uv run python …` or `uv python find`.

## Package Ownership
- `deedlit.dev/`: marketing site, home page, books, gallery presentation, services, static content, and PWA-related work.
- `deedlit.dev.comfyhelper/`: generated-image library — metadata extraction, PostgreSQL (canonical) + Neo4j (graph) + Qdrant (vectors), RustFS/S3 object storage, REST APIs, and MCP tools. See `deedlit.dev.comfyhelper/IMAGE_LIBRARY.md`.
- `deedlit.dev.ui/`: shared UI components, icons, tokens, CSS variables, and app-agnostic presentation primitives.

## Working Rules
- Make the smallest package-local change that solves the task.
- Do not duplicate shared UI between apps; promote reusable pieces into `deedlit.dev.ui`.
- Do not move app-specific domain behavior into `deedlit.dev.ui`.
- Treat package-level docs and source layout as more trustworthy than old summary docs when they disagree.
- When a task spans packages, keep ownership clear: shared primitive in `deedlit.dev.ui`, integration in the consuming app.

## Package Entry Points
- `deedlit.dev/`: start from `src/app/`, `src/features/`, and `scripts/`.
- `deedlit.dev.comfyhelper/`: start from `app/`, `lib/`, `prisma/`, and `.github/instructions/`.
- `deedlit.dev.ui/`: start from `src/`, `styles/`, and the package exports in `package.json`.

## Command Reference
- Build shared UI: `npm run build:ui`
- Run landing app: `npm run dev:dev`
- Run comfyhelper: `npm run dev:comfyhelper`
- Build all workspaces: `npm run build`

## Commit Convention

All commits must follow **[Conventional Commits](https://www.conventionalcommits.org/)**:

```
<type>(optional scope): <description>
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `perf`.

## Agent skills

### Issue tracker

Issues live as GitHub issues on `carneirofc/deedlit.dev` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context monorepo (root `CONTEXT.md` + `docs/adr/`, with authoritative package-local docs). See `docs/agents/domain.md`.

## Instruction Layout
- Root `.github/copilot-instructions.md` contains shared monorepo rules.
- Each package has its own `.github/copilot-instructions.md` for local architecture.
- Scoped `.instructions.md` files exist only where targeted guidance materially improves work quality.
