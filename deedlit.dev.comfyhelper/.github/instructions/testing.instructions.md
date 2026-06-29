---
applyTo: "tests/**,**/*.spec.ts,playwright*.config.ts"
description: "Use when editing Playwright tests or Playwright configuration in deedlit.dev.comfyhelper."
---

# Testing — Comfyhelper

## Test Surface
- Unit-style browser tests run through `playwright.unit.config.ts` with `npm run test:unit`.
- End-to-end flows run through `playwright.config.ts` with `npm run test:e2e`.
- Interactive debugging is available through `npm run test:e2e:ui`.

## Core Rules
- Prefer semantic selectors first, then `data-testid` via the `testId` prop on `@carneirofc/ui` components when semantics are insufficient.
- Keep assertions strict. Fix the behavior or the state setup instead of weakening checks.
- Avoid broad `waitForTimeout` sleeps. Wait on visible UI transitions, network responses, or stable route state.
- Reset or isolate scan/database state so tests do not depend on previous runs.
- Remember that event buses and worker services are long-lived in development/runtime. Tests should avoid depending on prior event history, prior scan jobs, or previously bootstrapped worker state.

## High-Risk Areas
- Scan trigger to SSE progress to gallery refresh.
- Admin root-directory configuration.
- Gallery filtering, pagination, and modal behavior.
- Stats refresh and any derived prompt-analysis output.
- SSE reconnection and event delivery through `/api/events`.

## Event-Driven Test Guidance
- Cover the real flow boundaries when behavior changes: trigger the scan, observe the SSE/status update, then verify the gallery or stats consumer reacts correctly.
- For reconnect or replay behavior, assert against observable outcomes such as delivered messages, refreshed UI, or restored progress state rather than implementation-only timing guesses.
- Keep tests isolated from stale persisted jobs or cached event history. If a scenario depends on a fresh scan lifecycle, set it up explicitly.
- Prefer deterministic waits tied to event delivery, route responses, or UI state changes over generic delays, especially around scan progress and SSE.
- If a change adds a new worker event or realtime message type, add or update tests around the contract boundary rather than only testing a downstream component.

## Exploratory Sessions
- Run exploratory Playwright sessions in headed mode so rendering, timing, and SSE behavior are visible.
- Keep one-off debugging helpers temporary unless they become part of the maintained test suite.

