# deedlit.dev — Public Site

## Purpose
- Public-facing Next.js site (port 3001): home / services hub, books shelf (Goodreads metadata), image gallery, services listing, and PWA-facing work.

## Ownership
- Owns landing/content routes, the Goodreads scrape pipeline, and PWA assets.
- Must NOT own generic reusable UI primitives — those belong in `deedlit.dev.ui`.

## Local Contracts
- App Router, Server Components by default: `src/app/` (`books`, `gallery`, `image`, `api`, `layout.tsx`, `manifest.ts`, `robots.ts`, `sitemap.ts`); feature folders under `src/features/{books,gallery,home,services,showcase}/`; `src/components/{layout,pwa}/`; `src/lib/`.
- `scripts/scrape-goodreads.ts` populates `src/features/books/data/books-metadata.json` from `books-config.ts` (`npm run scrape-goodreads`).
- Consumes `@carneirofc/ui` via `file:../deedlit.dev.ui`; `build` rebuilds the UI first. No backend/gateway dependency.
- Conventions: `.github/copilot-instructions.md` (App Router, feature folders, reuse `@carneirofc/ui`). Note: the `test:e2e` script exists but no Playwright config or `e2e/` specs are currently committed — treat old `e2e/` references (and `.cursorrules`) as historical.

## Work Guidance
- Keep changes package-local; promote reusable UI to `deedlit.dev.ui` rather than duplicating it here.

## Verification
- `npm run lint` · `npm run build` (from repo root: `npm run dev:dev`). `npm run test:e2e` is defined but has no committed specs yet.

## Child Guides
- [`docs/AGENTS.md`](./docs/AGENTS.md) — Playwright/testing & local-setup guide for this app (port 3001, npm scripts, scraper). Reference material; verify against `package.json` before relying on the e2e steps, since no Playwright specs are currently committed.
