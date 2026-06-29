# Deedlit Landing App — Copilot Instructions

## What This Package Owns
This package is the public-facing Next.js site for deedlit.dev. It handles the landing experience plus books, gallery presentation, project/service descriptions, and related content-driven routes.

## Architecture
- Use App Router patterns in `src/app/`.
- Default to Server Components. Add `"use client"` only when state, effects, browser APIs, or direct event handling require it.
- Keep features organized under `src/features/<feature>/` with collocated components, hooks, logic, data, and documentation when present.
- Shared site-level components belong in `src/components/`; cross-feature utilities belong in `src/lib/`.
- Use the `@/` alias for imports from `src/`.

## Data And Content Workflows
- Book metadata originates from the Goodreads scraping flow in `scripts/scrape-goodreads.ts` and feature data under `src/features/books/data/`.
- Prefer updating source configuration or generated data inputs rather than hardcoding derived content in UI components.
- Gallery and static content should remain easy to prerender and SEO-friendly.

## Shared UI Rules
- Reuse `@carneirofc/ui` before adding one-off primitives in this app.
- Keep app-specific composition in this package, but move generic controls or reusable surfaces into `deedlit.dev.ui`.
- Import the shared design language from `@carneirofc/ui` rather than creating conflicting styles.

## PWA And Frontend Concerns
- Keep service-worker and icon behavior consistent with the existing `public/` assets.
- Avoid adding client-side complexity to pages that can stay server-rendered.
- Preserve accessible markup and stable test selectors when introducing new interactive elements.

## Testing And Verification
- This package exposes `npm run test:e2e`, but the current tree does not include committed Playwright spec files or config files. Treat old docs that refer to `e2e/` as historical unless the test files are reintroduced.
- If Playwright tests are added back, prefer semantic locators first and stable `data-testid` attributes where semantic selectors are not enough.
- Keep scraper or content-generation changes easy to verify from generated outputs.

## Common Commands
- Dev server: `npm run dev`
- Production build: `npm run build`
- Goodreads scrape: `npm run scrape-goodreads`
- Playwright examples: `npm run playwright-examples`

## Change Boundaries
- Do not edit monorepo root scripts when a package-local script change is sufficient.
- Do not place shared UI primitives in this app if both apps would consume them.
