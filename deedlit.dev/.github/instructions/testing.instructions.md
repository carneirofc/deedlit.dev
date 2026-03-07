---
applyTo: "scripts/playwright-examples.ts,**/*.spec.ts,**/playwright*.ts,**/playwright*.js"
description: "Use when working on Playwright tests, browser automation, or test utilities in the deedlit.dev landing app."
---

# Testing Guidance For The Landing App

- The committed package tree currently exposes Playwright as a dependency and a `test:e2e` script, but it does not include checked-in `e2e/` specs or Playwright config files. Verify the actual test surface before assuming old docs are current.
- Keep test coverage focused on user-visible behavior: books discovery flows, gallery browsing, navigation, and service content.
- Prefer semantic locators and accessible markup first. Add `data-testid` only when semantic selectors are insufficient.
- Do not paper over flaky behavior with long sleeps. Wait on visible UI state, navigation, or network conditions instead.
- If you add Playwright tests back to this package, keep them aligned with the current route structure under `src/app/` and the feature modules under `src/features/`.
- Use `scripts/playwright-examples.ts` as a reference for browser automation patterns, not as a substitute for committed assertions.
