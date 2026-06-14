# ADR 0001 — Async queues for labelling and indexing

- **Status:** Accepted
- **Date:** 2026-06-14
- **Deciders:** carneirofc (grill-me session)
- **Tracking issues:** #25, #26, #27, #28, #29, #30

## Context

The per-file ingest pipeline (`deedlit.ingest`) runs **synchronously and in full**
before anything is persisted:

```
read bytes → sha256/phash/dims/thumbnail → metadata → label(LLM) → vision:dense → vision:sparse → catalog → search → graph
```

Two of those stages are slow and/or unreliable:

- **`label`** calls `deedlit.labelagent` (a vision LLM on a local llama-server) —
  seconds to minutes per image, and frequently down/restarting.
- **`vision:dense`** is GPU work, and `deedlit.vision` is profile-gated — in a
  default `docker compose up` it isn't even running.

Because catalog is written *last*, an image is invisible until the slowest stage
finishes. An in-memory `JobStore` async worker already exists, but it loses work
on restart, runs a single in-process worker, and cannot scale labelling
independently. We also lacked any UI to observe/debug queue internals or to
power-edit the catalog truth.

A latent bug compounded this: `pipeline.fetch_image_bytes` reads
`catalog GET /blobs/{sha}/original`, but catalog only stores `thumbnail` and
`embedding` blob kinds — so reindex/reconcile/backfill byte-fetch was broken.

## Decision

Restructure ingest around a **durable message broker (RabbitMQ)** with two
queues, a **synchronous fast path**, and a **catalog-resident task ledger**.

### Fast path (synchronous, returns in seconds)

```
read bytes → sha256/phash/dims/WebP-thumbnail → metadata /extract → catalog POST /images + PUT thumbnail → publish index + label tasks → return
```

No GPU and no LLM on this path. **Catalog write is the durability boundary.**

### Two queues / two task types (RabbitMQ, `aio-pika`)

- **`index` task** — the single projection-builder. Idempotent, rebuilds entirely
  from catalog truth: bytes (sha → catalog `filepath` → shared disk) → dense embed
  → sparse embed (prompt + description-if-present + tags) → `search /points`
  upsert → `graph /edges` upsert. Order-independent; last writer wins.
- **`label` task** — slow path: `labelagent /describe` → upsert catalog
  `description`/`safety`/AI-`tags` (COALESCE-friendly) → **publish a fresh `index`
  task** so the description flows into the sparse vector + payload + tags.

We accept a **2× dense embed per labeled image** in exchange for not adding a
partial-update endpoint to `search` and for trivial idempotency.

### Topology & deployment

- `deedlit.ingest` API does fast-path + publish + coarse ops.
- Consumers run from a **separate worker entrypoint in the same ingest image**
  (command override), deployed as their own compose service(s); a `QUEUES` env
  selects which queue a replica drains, so **label workers scale independently**
  of index workers.
- `deedlit.labelagent` stays a **pure stateless `/describe`** service (no DB, no
  write clients).

### Reliability

- **Best-effort publish + reconcile safety net.** If RabbitMQ is unreachable, the
  catalog write still lands; the image is cataloged-but-unprojected. The existing
  **reconcile** (re-drives `index`) and **label-backfill** (re-drives `label`)
  sweeps — now task *producers* — re-enqueue when the broker returns. No outbox.
- **Bounded retries with exponential backoff** (TTL + dead-letter-exchange delay
  queues; no broker plugin), uniform across both queues, then **per-queue DLQ**
  (`index.dlq` / `label.dlq`) with manual requeue/discard from the UI.
- Relying on **index idempotency** instead of dedup-coalescing (duplicate
  enqueues are wasted GPU, never incorrect).

### Two-level work model

Coarse operations (folder-scan / reconcile / rebuild / backfill) stay in the
in-memory `JobStore` + `GET /jobs`, but now **publish** per-image tasks instead of
inline reindex. Per-image work = broker messages + ledger rows.

### Task ledger

A catalog **`tasks` table** (Postgres) is a **best-effort observability/history
projection** (`queued`/`running`/`done`/`failed`/`dlq`, attempts, error,
`parent_op_id`, timestamps). RabbitMQ remains the source of truth for outstanding
work; a failed ledger write never fails a task. This keeps the "ingest holds no
DB driver" principle intact and gives the UI a queryable history.

### Bytes access (and bug fix)

Workers obtain bytes by **sha → catalog `filepath` → read shared host disk**
(single-box GPU setup). This replaces and repairs the broken
`/blobs/{sha}/original` fetch. No originals are duplicated into RustFS.

### UI surfaces

- **Queue visualization / debug page** — sourced from the ledger + a thin
  gateway proxy of the RabbitMQ management API (creds held server-side): queue
  depths, consumers, DLQ contents with requeue/discard/purge, recent failures,
  per-image task status; deep-link to RabbitMQ's own Management UI.
- **DB power-user / debug page** — structured browser/editor over catalog truth:
  filter images, inspect raw JSON (`params`/`workflow_json`/`api_prompt_json`),
  edit curated fields, delete, and trigger per-image ops (re-label / re-index /
  delete-everywhere). Projections (Neo4j/Qdrant) are inspected read-only and
  repaired by re-indexing — never edited directly.

### Safety

No auth for now: typed-confirm dialogs on destructive actions, gateway stays
localhost-bound. Add a shared token the moment the gateway is exposed beyond
localhost.

## Consequences

**Positive**
- Images are cataloged + visible in seconds; slow/unreliable work is decoupled,
  durable, retried, and independently scalable.
- A broker outage no longer halts ingest; existing repair sweeps are the net.
- The `fetch_image_bytes` bug is fixed as a side effect.
- New observability (queue page) and power tooling (DB page).

**Negative / trade-offs**
- New infra (RabbitMQ) + a worker service to operate.
- 2× dense embed per labeled image (chosen simplicity over a partial-update path).
- The catalog gains an operational `tasks` table (mild bounded-context bleed) and
  operational write chatter (best-effort, off the critical path).
- Eventual consistency: an image can be searchable before it is labeled, and
  labeled before the description reaches search (converges via idempotent
  index rebuilds).

## Alternatives considered

- **Reorder the existing in-memory queue, no broker** — rejected: no durability,
  single worker, no independent scaling, no DLQ.
- **Postgres-only queue (SKIP LOCKED)** — no new infra and a free queryable
  ledger, but weak live gauges, no native DLQ/mgmt UI, hand-rolled retry.
- **Scoped patch (no dense recompute)** — efficient, but needs a new `search`
  partial-update endpoint; deferred in favor of re-enqueuing an index task.
- **Transactional outbox** — strongest delivery guarantee; rejected as
  unnecessary given the reconcile/backfill safety net.
- **Fine-grained per-stage task DAG** — maximal parallelism, but requires a task
  orchestrator; rejected for complexity.
