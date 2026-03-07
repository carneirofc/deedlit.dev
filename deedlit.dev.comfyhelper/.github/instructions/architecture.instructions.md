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