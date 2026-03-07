# Comfyhelper — Copilot Instructions

## What This Package Owns
This package is the Next.js application for browsing and managing local ComfyUI image libraries. It owns filesystem scans, metadata ingestion, admin configuration, notes, stats, and real-time updates.

## Architecture
- Treat Zod schemas in `lib/contracts/` as the source of truth for boundary types. Infer TypeScript types from schemas instead of writing duplicate boundary interfaces.
- API handlers should validate outputs with `jsonWithSchema(...)` and use the shared route helpers in `lib/http/route-response.ts`.
- Background workers are bootstrapped from `instrumentation.ts` and persist through HMR using `globalThis.__comfyhelper*` keys.
- SSE messaging flows through `/api/events`, `lib/messaging/event-bus.ts`, and the typed realtime schemas in `lib/contracts/realtime.ts`.
- TanStack Query owns server-state caching. Query keys come from `lib/queries/query-keys.ts`; do not inline ad hoc string keys.
- Jotai is for transient UI/runtime state such as scan progress and SSE client state.

## Database And Persistence
- Prisma + SQLite back the app configuration and persisted state.
- Keep schema changes in `prisma/schema.prisma` and follow them with a migration.
- Preserve the Prisma singleton pattern in `lib/db/client.ts` so development HMR does not create duplicate clients.

## Shared UI Rules
- Reuse `@deedlit.dev/ui` primitives before building app-local controls.
- Keep token-driven styling aligned with `@deedlit.dev/ui/styles.css`.
- App-specific components can live in `app/` or `components/`, but they should still compose shared primitives instead of reinventing them.
- Use the `testId` prop on shared UI components when a stable selector is needed for tests.

## Runtime Rules
- Anything that must survive Next.js remounts in development should use an explicit `globalThis.__comfyhelper*` singleton.
- Keep server-only logic in server-side modules; do not leak worker, Prisma, or filesystem behavior into purely client components.
- Follow the existing SSE event envelope and channels instead of inventing parallel event shapes.

## Common Commands
- Dev server: `npm run dev`
- Production build: `npm run build`
- Unit tests: `npm run test:unit`
- E2E tests: `npm run test:e2e`
- Interactive Playwright UI: `npm run test:e2e:ui`

## Change Boundaries
- Put app-agnostic UI primitives in `deedlit.dev.ui`, not here.
- Keep ComfyUI-specific parsing, scan orchestration, and persistence behavior inside this package.
- Read the scoped instruction files for testing and backend/runtime architecture before modifying those areas.

