# deedlit.dev.comfyhelper — ComfyHelper UI

## Purpose
- Next.js app (port 3000): UI for browsing and managing the generated-image library — hybrid search, tag/safety filters, Neo4j graph filter, and an admin page for ingestion, source folders, cache, and maintenance jobs.

## Ownership
- UI only. No database, no direct datastore access — every read/write proxies through the `deedlit.api` gateway.
- Must not own app-agnostic primitives (those belong in `deedlit.dev.ui`) and must not reimplement MCP tools (those live in `deedlit.api/mcp.py`).

## Local Contracts
- Source of truth for architecture: `IMAGE_LIBRARY.md` + `README.md` + the actual code (`lib/api-client.ts`, `app/api/mcp/route.ts`, `app/api/library/**`, `lib/library/**`, `lib/store/**`).
- ⚠️ `.github/copilot-instructions.md` and `.github/instructions/architecture.instructions.md` describe a pre-refactor Prisma/contracts/messaging/worker monolith that no longer exists — do not follow them for architecture; prefer `IMAGE_LIBRARY.md` and the current tree.
- `package.json` name `deedlit.dev.comfyhelper`; talks to the gateway at `DEEDLIT_API_URL` (default `http://localhost:8088`). `dev` starts Redis then `next dev`.
- Playwright configs: `playwright.config.ts` (e2e, `tests/e2e`), `playwright.unit.config.ts` (`tests/unit/*.unit.ts`), `playwright.verify.config.ts` (`*verify*.spec.ts`). Only `test:e2e*` scripts are wired into `package.json`.
- Cross-service id helper: `lib/library/id-scheme.ts` (see [`../id-scheme/`](../id-scheme/AGENTS.md)).

## Work Guidance
- Keep the app a gateway client — no datastore logic. New backend behavior belongs in the owning FastAPI service, exposed via `deedlit.api`.

## Verification
- `npm run lint` · `npm run build` · `npm run test:e2e` (from repo root: `npm run dev:comfyhelper`).

## Child Guides
- None.
