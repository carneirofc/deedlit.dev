# Comfyhelper — Copilot Instructions

## What This Package Owns
This package is the Next.js application for browsing and managing local ComfyUI image libraries. It owns filesystem scans, metadata ingestion, admin configuration, notes, stats, and real-time updates.

## First Read
- Read `.github/instructions/architecture.instructions.md` before changing API routes, contracts, workers, SSE, or persistence code.
- Read `.github/instructions/testing.instructions.md` before changing Playwright tests or behavior that depends on scan/event timing.

## Architecture
- Treat Zod schemas in `lib/contracts/` as the source of truth for boundary types. Infer TypeScript types from schemas instead of writing duplicate boundary interfaces.
- API handlers should validate outputs with `jsonWithSchema(...)` and use the shared route helpers in `lib/http/route-response.ts`.
- Background workers are bootstrapped from `instrumentation.ts` and persist through HMR using `globalThis.__comfyhelper*` keys.
- Treat the eventing system as an existing architecture, not a greenfield design problem. Extend the typed event bus, worker event schemas, and replayable channel helpers instead of inventing parallel queue or transport abstractions.
- Internal worker events flow through `lib/messaging/worker.ts` and `lib/contracts/worker.ts`. Public realtime events flow through `/api/events`, `lib/messaging/scan.ts`, `lib/messaging/gallery.ts`, and the typed schemas in `lib/contracts/realtime.ts`.
- TanStack Query owns server-state caching. Query keys come from `lib/queries/query-keys.ts`; do not inline ad hoc string keys.
- Jotai is for transient UI/runtime state such as scan progress and SSE client state.

## Scan And Event Flow
- Preserve the existing pipeline: file watcher detects changes, scan coordinator debounces and triggers scans, scans update persisted state, and SSE streams publish scan/gallery updates.
- Start or coordinate scans through existing store/orchestration entry points such as `startAsyncLibraryScan(...)`; do not add alternate scan starters in routes or components.
- The event bus is schema-validated and history-backed. New event kinds should extend the current channels and payload schemas rather than introducing loosely typed envelopes.
- `/api/events` already implements snapshot, replay, live subscription, and heartbeat behavior. Extend that contract carefully instead of adding separate realtime endpoints for the same data.

## Database And Persistence
- Prisma + SQLite back the app configuration and persisted state.
- Keep schema changes in `prisma/schema.prisma` and follow them with a migration.
- Preserve the Prisma singleton pattern in `lib/db/client.ts` so development HMR does not create duplicate clients.
- Be careful around scan-job persistence. The scan store already includes stale-job recovery; changes around job lifecycle should preserve that self-healing behavior rather than layering on a second recovery mechanism.

## Shared UI Rules
- Reuse `@deedlit.dev/ui` primitives before building app-local controls.
- Keep token-driven styling aligned with `@deedlit.dev/ui/styles.css`.
- App-specific components can live in `app/` or `components/`, but they should still compose shared primitives instead of reinventing them.
- Use the `testId` prop on shared UI components when a stable selector is needed for tests.

## Runtime Rules
- Anything that must survive Next.js remounts in development should use an explicit `globalThis.__comfyhelper*` singleton.
- Keep server-only logic in server-side modules; do not leak worker, Prisma, or filesystem behavior into purely client components.
- Follow the existing SSE event envelope and channels instead of inventing parallel event shapes.
- Worker services should register with the worker manager and respect the existing start/stop lifecycle instead of spinning up ad hoc background loops per request.
- Long-lived services and subscriptions must be abort-safe and clean up listeners, timers, and filesystem resources when stopped.

## Editing Heuristics
- When adding worker or realtime behavior, update schemas first, then the emitter/subscriber helper, then the route or consumer.
- Prefer extending existing channels (`worker-manager`, `file-watcher`, `scan-coordinator`, `scan`, `gallery`, `stats`, `system`) before creating new ones.
- Keep queue-like behavior explicit in the current event-driven pipeline. If work is already represented as a worker event, scan job, or replayable stream message, extend that path instead of duplicating state.

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

