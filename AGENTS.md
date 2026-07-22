# Deedlit Monorepo Agent Guide

Root guide for the monorepo: project-wide instructions, global preferences, durable workflow rules, and the index of nested `AGENTS.md` guides. Each package's own `AGENTS.md` is the local contract for its subtree; this file holds repo-wide rules and points to the rest. See [Maintaining These Guides](#maintaining-these-guides) before editing any `AGENTS.md`.

## Start Here
- The repo root is a workspace orchestrator, not the primary home of application logic.
- Check `package.json` at the repo root for workspace-level commands, then move into the package that owns the task.
- Read the nearest package-local `.github/copilot-instructions.md` before editing code.
- Toolchain not on the bare PATH: Node is via **fnm** (`fnm env --use-on-cd | Out-String | Invoke-Expression`), Python via **uv** (`uv run …`) — full details in [`docs/agents/toolchain.md`](docs/agents/toolchain.md).

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

## Agent Skills
- **Issue tracker** — issues live as GitHub issues on `carneirofc/deedlit.dev` via the `gh` CLI. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).
- **Triage labels** — canonical vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).
- **Domain docs** — single-context monorepo (root `CONTEXT.md` + `docs/adr/`, with authoritative package-local docs). See [`docs/agents/domain.md`](docs/agents/domain.md).

## Maintaining These Guides

`AGENTS.md` files are the working contract for their subtree. Any file, folder, or workflow should stay understandable from the nearest `AGENTS.md` plus every parent above it. Follow these rules across any edit.

### Read before editing
1. Read this root guide.
2. Identify every file or folder you expect to touch, and walk from the repo root to each one.
3. Read every `AGENTS.md` along the way; when a guide lists a nested child whose scope contains your path, read that child and continue from there.
4. Use the nearest `AGENTS.md` as the local contract and parent guides for repo-wide rules. If they conflict, the closer guide wins for local details.

Re-read the relevant guides in the current session — don't rely on memory.

### Update after editing
Update the closest owning `AGENTS.md` when a change affects:
- purpose, scope, ownership, or responsibilities;
- durable structure, contracts, workflows, or operating rules;
- required inputs, outputs, permissions, constraints, side effects, or artifacts;
- user preferences about behavior, process, organization, or quality;
- creation, deletion, move, rename, or index contents of any `AGENTS.md`.

Update parent guides when parent-level structure, ownership, workflow, or the child index changes; update child guides when a parent change alters local rules. Remove stale or contradictory text immediately.

### Hierarchy & shape
- The root guide holds project-wide rules, global preferences, and the top-level child index. Nested guides own domain-specific rules and their own child index. Each parent explains what its direct children cover and what stays owned by the parent.
- The closer a guide is to the work, the more specific and practical it must be.
- Add a nested `AGENTS.md` when a folder becomes a durable boundary with its own purpose, rules, workflow, or quality standards. Suggested section order: Purpose, Ownership, Local Contracts, Work Guidance, Verification, Child Guides. Leave Work Guidance or Verification empty until real standards or checks exist.

### Style
- Keep guides concise, current, and operational — document stable contracts, not history.
- Put broad rules in parent guides, concrete details in child guides; don't duplicate a rule across scopes unless each needs a local version.
- Prefer direct bullets with explicit names. Delete stale notes instead of explaining them.

### Closeout
1. Re-check changed paths against the guides above them.
2. Update the nearest owning guide and any affected parents or children, and refresh every affected child index.
3. Remove stale or contradictory text, run existing verification when relevant, and report any guide left unchanged and why.

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md.

## Child Guides

Each nested `AGENTS.md` is the local contract for its subtree. Ownership detail lives in the child; this index is the map.

### Agent operating docs (`docs/agents/`)
- [`docs/agents/toolchain.md`](docs/agents/toolchain.md) — fnm/uv toolchain locations & activation (Windows/PowerShell).
- [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) — GitHub-issue workflow via `gh`.
- [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md) — canonical triage vocabulary.
- [`docs/agents/domain.md`](docs/agents/domain.md) — domain-doc reading order and glossary rules.

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
