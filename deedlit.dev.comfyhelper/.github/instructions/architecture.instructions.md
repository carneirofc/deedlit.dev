---
applyTo: "app/api/**,lib/contracts/**,lib/http/**,lib/messaging/**,lib/queries/**,lib/store/**,lib/workers/**,instrumentation.ts,prisma/**"
description: "Use when changing comfyhelper backend/runtime architecture, including contracts, API routes, workers, SSE, Prisma, or query/store wiring."
---

# Backend And Runtime Architecture

- Define boundary shapes in Zod first under `lib/contracts/`, then infer TypeScript types from those schemas.
- Route handlers should parse inputs with schemas where applicable and validate outputs with `jsonWithSchema(...)`.
- Error responses should use the shared helpers from `lib/http/route-response.ts`.
- Keep query keys centralized in `lib/queries/query-keys.ts`; do not create inline cache-key strings in components or hooks.
- Use Jotai only for transient UI/runtime state. Persisted or server-derived data should stay in Prisma or TanStack Query.
- Preserve the single SSE envelope model and existing event channels instead of inventing parallel transport shapes.
- Workers bootstrapped from `instrumentation.ts` must remain server-only and HMR-safe via explicit `globalThis.__comfyhelper*` keys.
- Prisma changes belong in `prisma/schema.prisma` and should be followed by a migration with a descriptive name.

## Eventing And Messaging

- Treat `lib/messaging/event-bus.ts` as the base primitive for long-lived typed events. Do not bypass it with ad hoc `EventEmitter`, in-memory arrays, or custom websocket/SSE payload formats.
- Every new worker event kind must have a Zod payload schema registered through the existing worker-event path. Extend `lib/contracts/worker.ts` first, then emit through `lib/messaging/worker.ts`.
- Public realtime messages should extend the existing replayable channel helpers in `lib/messaging/scan.ts`, `lib/messaging/gallery.ts`, or adjacent helpers built on `createReplayableChannel(...)`.
- Preserve replay semantics: replayable events carry ids/sequences, snapshot messages do not, and `/api/events` is responsible for snapshot -> replay -> live delivery.
- Keep channel naming and message types aligned with the current contract families: worker channels for internal service coordination, `scan` and `gallery` for replayable public events, `system` for heartbeat, and `stats` for statistics streaming.
- Avoid introducing a second queue abstraction unless the package genuinely gains a new execution model. Most queue-like behavior here already lives in the worker event pipeline plus persisted scan jobs.

## Worker Lifecycle

- Register background services with the worker manager and let `bootstrapWorkers()` own startup. Do not start long-lived services from request handlers, React components, or module side effects outside the existing bootstrap path.
- Service implementations must respect `ctx.signal` and clean up timers, subscriptions, and file watchers during shutdown.
- Use the manager lifecycle helpers (`registerService`, `startService`, `stopService`, `startAll`, `getWorkerManagerHealth`) instead of duplicating service state machines.
- Keep worker/runtime singletons HMR-safe. If a new long-lived registry or service instance must survive reloads, store it under an explicit `globalThis.__comfyhelper*` key.
- Be explicit about failure behavior. Startup failures currently surface through worker events and manager health; do not hide them behind silent retries unless the runtime model is intentionally changing.

## Scan And SSE Boundaries

- Start scans through the existing orchestration layer in `lib/image-cache-store.ts`. Routes may request scans, but orchestration and stale-job recovery stay centralized there.
- Preserve the scan pipeline: filesystem/root changes -> worker events -> scan trigger/debounce/cooldown -> persisted scan job updates -> replayable SSE messages.
- `/api/events` must remain a Node.js, force-dynamic SSE endpoint that sends the current scan snapshot, replays recent scan/gallery events, subscribes to live updates, and emits heartbeat messages.
- When changing replay limits, channel history, or scan progress payloads, consider both server memory pressure and client reconnection behavior.
- Keep route code thin. Contract/schema changes should usually happen in `lib/contracts/*` and messaging helpers before route handlers are updated.