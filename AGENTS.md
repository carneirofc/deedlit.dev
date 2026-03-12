# Deedlit Monorepo Agent Guide

## Start Here
- The repo root is a workspace orchestrator, not the primary home of application logic.
- Check `package.json` at the repo root for workspace-level commands, then move into the package that owns the task.
- Read the nearest package-local `.github/copilot-instructions.md` before editing code.

## Package Ownership
- `deedlit.dev/`: marketing site, home page, books, gallery presentation, services, static content, and PWA-related work.
- `deedlit.dev.comfyhelper/`: ComfyUI image management, metadata parsing, Prisma/SQLite persistence, scans, SSE, admin tools, notes, and stats.
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

## Instruction Layout
- Root `.github/copilot-instructions.md` contains shared monorepo rules.
- Each package has its own `.github/copilot-instructions.md` for local architecture.
- Scoped `.instructions.md` files exist only where targeted guidance materially improves work quality.
