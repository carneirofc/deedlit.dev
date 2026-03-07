# Deedlit Monorepo — Copilot Instructions

## Workspace Map
- `deedlit.dev/` is the public-facing Next.js site for the deedlit.dev landing experience, books, gallery, and service descriptions.
- `deedlit.dev.comfyhelper/` is the Next.js app for managing ComfyUI image libraries, metadata, notes, and scan workflows.
- `deedlit.dev.ui/` is the shared React UI package consumed by both apps as `@deedlit.dev/ui`.

## Monorepo Rules
- Start in the package that owns the behavior. Do not edit multiple packages unless the change genuinely crosses package boundaries.
- Put reusable, app-agnostic UI primitives in `deedlit.dev.ui`; keep app-specific components inside the app that owns the domain logic.
- Before assuming a component should be copied into an app, check whether `@deedlit.dev/ui` already has a suitable primitive.
- Root scripts orchestrate the workspace, but package-local scripts remain the source of truth for package-specific build, dev, and test commands.
- When changing either Next.js app, account for the shared UI build step. Both apps already depend on `deedlit.dev.ui` being built before development or production builds.

## Package Selection Heuristics
- Choose `deedlit.dev/` for marketing pages, portfolio content, Goodreads/book flows, gallery presentation, service listings, and PWA-facing work.
- Choose `deedlit.dev.comfyhelper/` for filesystem scans, image metadata processing, SQLite/Prisma state, SSE flows, admin configuration, stats, notes, or ComfyUI-specific behavior.
- Choose `deedlit.dev.ui/` for shared buttons, inputs, dialogs, panels, badges, icons, layout primitives, design tokens, and component styling conventions reused by both apps.

## Shared Engineering Expectations
- Keep changes minimal and package-scoped.
- Preserve strict TypeScript behavior and existing naming conventions.
- Prefer existing docs and current package structure over stale assumptions.
- Document specialized workflow rules in package-local `.github/instructions/*.instructions.md` files instead of duplicating them at the monorepo root.
- If a task touches shared UI and an app, update the UI package first, then adjust the consuming app.

## Common Commands
- Root workspace build: `npm run build`
- Root shared UI build: `npm run build:ui`
- Landing app dev: `npm run dev:dev`
- Comfyhelper dev: `npm run dev:comfyhelper`

## Where To Look Next
- Read the package-local `copilot-instructions.md` before making package-specific changes.
- Read scoped `.instructions.md` files when working in tests, shared UI component authoring, or comfyhelper backend/runtime code.
