# docs — Repo Documentation

## Purpose
- Repo-level documentation: architecture decision records, agent operating conventions, screenshots, and the public GitHub Pages landing site.

## Ownership
- Owns durable cross-repo docs. Package-specific docs stay in their own package.

## Local Contracts
- `adr/` — decision records (source of truth for the ingest design):
  - `0001-async-queues-for-labelling-and-indexing.md` (Accepted).
  - `0002-per-stage-ingest-dag.md` (Accepted; makes ingest fully queue-driven, RabbitMQ a hard dependency).
- `agents/` — agent workflow conventions:
  - `domain.md` — read root context + relevant ADRs before exploring; flag ADR conflicts rather than overriding.
  - `issue-tracker.md` — issues/PRDs live as GitHub issues on `carneirofc/deedlit.dev` via the `gh` CLI.
  - `triage-labels.md` — canonical triage vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`).
- `screenshots/` — images used by the root `README.md` and the landing page.
- `site/index.html` — the GitHub Pages landing page, published via [`../.github/workflows/storybook-pages.yml`](../.github/workflows/storybook-pages.yml).

## Work Guidance
- Add a new ADR rather than rewriting history; keep `agents/` docs aligned with the actual `gh`-based workflow and label set.

## Verification
- None automated — ADRs/agent docs are read as guidance; `site/index.html` is served statically via GitHub Pages.

## Child DOX Index
- None.
