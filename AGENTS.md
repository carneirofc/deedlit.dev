# Deedlit Monorepo Agent Guide

## Start Here
- The repo root is a workspace orchestrator, not the primary home of application logic.
- Check `package.json` at the repo root for workspace-level commands, then move into the package that owns the task.
- Read the nearest package-local `.github/copilot-instructions.md` before editing code.

## Toolchain & Environment (Windows / PowerShell)
Don't go hunting for these every session — they are version-managed, not on the bare PATH.

### Node — managed by **fnm**
- `fnm.exe`: `%LOCALAPPDATA%\Microsoft\WinGet\Links\fnm.exe` (already on PATH).
- `FNM_DIR`: `%APPDATA%\fnm`; installed versions live under `…\fnm\node-versions\`.
- Default/active version: **v24.13.1** (`node` resolves into an fnm multishell, not a fixed path).
- Activate in a PowerShell session (the Bash/PowerShell tool does NOT auto-load fnm):
  ```powershell
  fnm env --use-on-cd | Out-String | Invoke-Expression
  ```
  After that, `node`, `npm`, `npx` work. `--use-on-cd` makes fnm honor a repo's `.node-version`/`.nvmrc` on entry. Use `npm` for workspace scripts (see Command Reference).

### Python — managed by **uv**, per-package venvs
- `uv.exe`: `%USERPROFILE%\.local\bin\uv.exe` (on PATH).
- ⚠️ Bare `python` on PATH is the **Windows Store stub** (`%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe`) — do not use it.
- `deedlit.vision/` has its own venv: `deedlit.vision\.venv` (**Python 3.14.5**).
  - Activate: `deedlit.vision\.venv\Scripts\Activate.ps1`
  - Or run without activating: `uv run --project deedlit.vision <cmd>` (or `cd deedlit.vision; uv run <cmd>`).
- To get a python without a venv: `uv run python …` or `uv python find`.

## Package Ownership
- `deedlit.dev/`: marketing site, home page, books, gallery presentation, services, static content, and PWA-related work.
- `deedlit.dev.comfyhelper/`: generated-image library **UI** (Next.js) — talks to the `deedlit.api` gateway. See `deedlit.dev.comfyhelper/IMAGE_LIBRARY.md` for the backend architecture.
- `deedlit.dev.ui/`: shared UI components, icons, tokens, CSS variables, and app-agnostic presentation primitives.
- `deedlit.<service>/`: FastAPI image-library services (`api`, `catalog`, `search`, `graph`, `ingest`, `metadata`, `labelagent`, `vision`) — database-per-service, HTTP-only, `uv`-managed. Each owns its store and is the sole writer of it.

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
- `deedlit.<service>/`: start from `app.py` (FastAPI entry), the package module (`<service>/`), `pyproject.toml`, and `tests/`. Ingest also has `worker.py` (the queue consumer).

## Command Reference
- Build shared UI: `npm run build:ui`
- Run everything (orchestrated): `npm run dev` — starts all services via `mprocs` (see `mprocs.yaml`); one pane per service, `r` restarts one, `q` tears everything down with clean process-tree kill (no orphaned ports on Windows). Start datastores first with `npm run infra:up`.
- Run landing app only: `npm run dev:dev`
- Run comfyhelper only: `npm run dev:comfyhelper`
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

# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:
- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

## Child DOX Index

Each child AGENTS.md is the local contract for its subtree. Ownership detail lives in the child; this index is the map.

### Web apps (npm workspace)
- [`deedlit.dev/AGENTS.md`](deedlit.dev/AGENTS.md) — public Next.js site (:3001): home, books, gallery, services, PWA. Nests [`deedlit.dev/docs/AGENTS.md`](deedlit.dev/docs/AGENTS.md) (testing/setup guide).
- [`deedlit.dev.comfyhelper/AGENTS.md`](deedlit.dev.comfyhelper/AGENTS.md) — ComfyHelper image-library UI (:3000), gateway client only.
- [`deedlit.dev.ui/AGENTS.md`](deedlit.dev.ui/AGENTS.md) — shared `@carneirofc/ui` component library + tokens.

### Gateway & FastAPI services (`uv` per-package)
- [`deedlit.api/AGENTS.md`](deedlit.api/AGENTS.md) — gateway / BFF (:8088); stateless.
- [`deedlit.catalog/AGENTS.md`](deedlit.catalog/AGENTS.md) — canonical truth (:8001); sole writer of Postgres + RustFS.
- [`deedlit.search/AGENTS.md`](deedlit.search/AGENTS.md) — hybrid vector search (:8002); sole writer of Qdrant.
- [`deedlit.graph/AGENTS.md`](deedlit.graph/AGENTS.md) — relationship graph (:8003); sole writer of Neo4j.
- [`deedlit.ingest/AGENTS.md`](deedlit.ingest/AGENTS.md) — ingest DAG orchestrator + worker (:8004); stateless, RabbitMQ publisher.
- [`deedlit.metadata/AGENTS.md`](deedlit.metadata/AGENTS.md) — PNG metadata extraction (:8005); stateless.
- [`deedlit.labelagent/AGENTS.md`](deedlit.labelagent/AGENTS.md) — vision-LLM labeling (:8006); stateless.
- [`deedlit.vision/AGENTS.md`](deedlit.vision/AGENTS.md) — CLIP/SPLADE embeddings (:8000, GPU); stateless.

> Ownership note: only `catalog`, `search`, and `graph` own datastores. `api`, `ingest`, `metadata`, `labelagent`, and `vision` are stateless.

### Cross-cutting
- [`contracts/AGENTS.md`](contracts/AGENTS.md) — OpenAPI design sketches + `validate.py` invariants.
- [`id-scheme/AGENTS.md`](id-scheme/AGENTS.md) — frozen SHA-256 / uuid5 cross-service identity + test vectors.
- [`observability/AGENTS.md`](observability/AGENTS.md) — Alloy/Loki/Tempo/Grafana config (Compose profile).
- [`docs/AGENTS.md`](docs/AGENTS.md) — ADRs, agent workflow docs, screenshots, Pages landing site.
