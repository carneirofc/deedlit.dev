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
- Prefer semantic selectors first, then `data-testid` via the `testId` prop on `@deedlit.dev/ui` components when semantics are insufficient.
- Keep assertions strict. Fix the behavior or the state setup instead of weakening checks.
- Avoid broad `waitForTimeout` sleeps. Wait on visible UI transitions, network responses, or stable route state.
- Reset or isolate scan/database state so tests do not depend on previous runs.

## High-Risk Areas
- Scan trigger to SSE progress to gallery refresh.
- Admin root-directory configuration.
- Gallery filtering, pagination, and modal behavior.
- Stats refresh and any derived prompt-analysis output.
- SSE reconnection and event delivery through `/api/events`.

## Exploratory Sessions
- Run exploratory Playwright sessions in headed mode so rendering, timing, and SSE behavior are visible.
- Keep one-off debugging helpers temporary unless they become part of the maintained test suite.

