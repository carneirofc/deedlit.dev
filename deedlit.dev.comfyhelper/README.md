# ComfyUI Image Library Explorer

Next.js app for browsing local ComfyUI image outputs.
## Using node

Activate the correct Node version with `fnm`:

```bash
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
```
## Features

- Admin panel to add/remove root directories to scan.
- SQLite-backed configuration and settings storage.
- Prisma ORM for all database reads/writes.
- Schema-first contracts in `lib/contracts` (Zod is source of truth for runtime validation + TS inference).
- Recursive `.png` discovery across all configured roots.
- Sidecar JSON metadata support in the same folder as each image:
  - `image.png.json`
  - `image.json`
- Gallery cards with preview, path, size, timestamp, and metadata details.
- Default scan limit setting persisted in database.

## Realtime Messaging (SSE v2)

`/api/events` and `/api/stats?stream=1` now emit a single SSE event name: `message`.
Every envelope is validated with shared contracts in `lib/contracts/realtime.ts`.

Event channels/types:
- `scan`: `scan.snapshot`, `scan.queued`, `scan.running`, `scan.completed`, `scan.failed`
- `gallery`: `gallery.images.changed`, `gallery.images.removed`
- `system`: `system.heartbeat`
- `stats`: `stats.batch`, `stats.complete`, `stats.error`

Envelope shape:
- `schemaVersion: 2`
- `channel`
- `type`
- `at`
- `payload`
- optional replay metadata for replayable events: `id`, `seq`

## Run Locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.
- Gallery: `http://localhost:3000`
- Admin panel: `http://localhost:3000/admin`

## E2E Test Suite (Playwright)

Run:

```bash
npm run test:e2e
```

Useful variants:

```bash
npm run test:e2e:headed
npm run test:e2e:ui
npm run test:e2e:report
```

Notes:
- Tests live in `tests/e2e`.
- Playwright config is `playwright.config.ts`.
- Default test base URL is `http://127.0.0.1:43000`.
- Override with `E2E_BASE_URL`, `E2E_HOST`, or `E2E_PORT`.

If Playwright is not installed yet, run:

```bash
npm install
npx playwright install chromium
```

## AI Prompt Pack For E2E

Prompt templates are included in `prompts/`:
- `prompts/e2e-run-and-fix.prompt.md`
- `prompts/e2e-update-suite.prompt.md`
- `prompts/e2e-exploratory-testing.prompt.md`

## Notes

- This app is intended for local/self-hosted use.
- Image file access is restricted to configured roots via the API layer.
- Metadata parsing errors are shown per image card rather than breaking the scan.
- SQLite database file is created at `data/comfyhelper.db` on first run.
