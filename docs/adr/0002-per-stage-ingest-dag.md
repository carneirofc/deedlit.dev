# ADR 0002 — Per-stage ingest DAG via catalog-rendezvous choreography

- **Status:** Proposed
- **Date:** 2026-06-14
- **Deciders:** carneirofc
- **Extends / partially supersedes:** [ADR 0001](0001-async-queues-for-labelling-and-indexing.md)
- **Tracking issues:** TBD

## Context

ADR 0001 made images visible in seconds (synchronous **fast path** → catalog
write) and moved the slow work onto **two** durable queues (`index`, `label`).
That solved the consumer side: `index`/`label` workers already scale
horizontally (replicas + `QUEUES` env + prefetch). Two limits remain:

1. **The producer (fast path) is serial.** `JobStore` runs one job at a time
   (`jobs.py` single `_run_worker`), and a folder job walks its files in a serial
   loop (`for path in files: await self._process_one`). Each file does a metadata
   HTTP round-trip + catalog write inline. For a large folder, *image
   availability itself* is throughput-bound to one in-process loop — the very
   thing "available asap" is supposed to guarantee at scale.

2. **`index` is a monolith.** One `index` task does dense embed (GPU) → sparse
   embed → search upsert → graph upsert. The GPU leg cannot scale separately from
   the cheap legs, and ADR 0001 accepted a **2× dense embed per labeled image**
   (relabel re-enqueues a full `index`, recomputing the GPU vector) to avoid a
   fan-in.

ADR 0001 explicitly **rejected** a "fine-grained per-stage task DAG" because it
"requires a task orchestrator." We now revisit that — but keep the rejection of a
heavyweight **orchestration engine** (Temporal/Prefect/Celery-canvas). The
insight that makes the DAG cheap: **the catalog is already the single source of
truth and the single datastore ingest is allowed to read.** It can serve as the
DAG's rendezvous point, so the fan-in needs no coordinator.

## Decision

Replace the single `index` queue with a **per-stage DAG of independently
scalable queues**, drive it by **choreography** (each stage persists its output
to catalog truth, then publishes its successors), and do the one fan-in
(search needs dense **and** sparse) by **rendezvous in the catalog** — not in an
engine and not in a join table.

### Queues (each its own retry/dlq, each independently scalable via `QUEUES`)

| queue          | work                                              | bound      |
|----------------|---------------------------------------------------|------------|
| `embed.dense`  | dense image embedding                              | **GPU**    |
| `embed.sparse` | sparse embedding over prompt+description+tags      | CPU        |
| `index.search` | upsert the Qdrant point (the **fan-in** consumer) | I/O        |
| `index.graph`  | upsert Neo4j reference/tag/lineage edges           | I/O        |
| `label`        | vision-LLM describe → patch catalog truth          | LLM, slow  |
| `ingest`       | opt-in cross-process fast-path pool (`INGEST_VIA_QUEUE`) | I/O, CPU |

The five always-on queues split ADR 0001's monolithic `index` task into per-stage
work. The **producer (fast path) is parallelized in-process by default** (bounded
concurrency, `INGEST_CONCURRENCY`), so the **catalog write stays the durability
boundary** (ADR 0001's outage resilience is preserved). Setting
**`INGEST_VIA_QUEUE`** flips the folder scan to publish a cheap `ingest` task per
file instead, letting the ingest-worker pool catalog across *processes*; if the
broker is down at publish time it **falls back to the inline fast path**, so the
catalog write still lands in either mode.

### Catalog as the rendezvous (persist each stage's output to truth)

- **dense** vector → catalog `embedding` blob (kind already exists). Persisting
  the expensive GPU result means it is **computed once and reused** — relabel /
  reindex never recompute it. This *removes* ADR 0001's 2× dense embed.
- **sparse** vector → catalog **new `sparse` blob kind** (small `{indices,
  values}` JSON).
- **record / description / safety / tags** → catalog row (unchanged).

`index.search` reads dense+sparse back from catalog and writes a **full** point
(`search POST /points` unchanged — no partial-update endpoint, preserving ADR
0001's reasoning). The rendezvous lives in catalog, not in search.

### Flow (choreography — each box publishes the next, all idempotent)

```
folder-scan (coarse op, JobStore)         # bounded-concurrency producer (INGEST_CONCURRENCY)
  per file, concurrently:
    read → sha/phash/dims/thumb/metadata → catalog POST /images + PUT thumb        # VISIBLE
    ├─ publish embed.dense
    ├─ publish embed.sparse
    ├─ publish index.graph                # graph needs no vectors → runs in parallel
    └─ publish label
embed.dense  (G replicas, GPU): bytes → dense → catalog PUT /blobs/{sha}/embedding → publish index.search
embed.sparse (S replicas):      catalog text → sparse → catalog PUT /blobs/{sha}/sparse → publish index.search
index.search (FAN-IN): read dense+sparse from catalog;
                       BOTH present → upsert search point;  else no-op (sibling's publish completes it)
index.graph:           catalog truth (refs/tags/lineage) → graph POST /edges
label (M replicas): describe → patch catalog desc/safety/tags
        ├─ publish embed.sparse           # description/tags changed the sparse text
        └─ publish index.graph            # tags changed
        # NOT embed.dense — image bytes are unchanged, so the dense vector is stable
```

The fast path runs **inline in the producer, concurrently** (a bounded
`asyncio` semaphore over the folder walk, `INGEST_CONCURRENCY`), so the catalog
write — and thus image availability — is parallelized without leaving the
process. The downstream stage tasks are published best-effort per ADR 0001
(reconcile / label-backfill re-enqueue on a broker hiccup).

### Fan-in without a coordinator

`index.search` is **idempotent and reads its inputs from catalog**. Both
`embed.dense` and `embed.sparse` publish it on completion. Whichever finishes
**second** finds both blobs present and writes the point; the first finds one
missing and is a clean no-op. No completion counter, no join row, no engine —
**catalog presence is the latch.** This is ADR 0001's own philosophy ("rely on
idempotency, not dedup-coalescing; a duplicate enqueue is wasted work, never
incorrect") applied to the fan-in.

### Topology & deployment

- Same single ingest image; `worker.py` gains a handler per queue; `QUEUES`
  selects the subset a replica drains. Suggested replica sets:
  `QUEUES=embed.dense` (the GPU pool, scaled to GPUs),
  `QUEUES=embed.sparse,index.search,index.graph` (the cheap I/O pool),
  `QUEUES=label`.
- `JobStore` coarse ops (folder-scan / reconcile / rebuild / backfill) stay the
  **producers**; the per-image fast path runs **inline with bounded concurrency**
  in that loop (not on a queue), which parallelizes availability while keeping the
  catalog-write durability boundary.

### Tuning parallelism

- **Fast stages** run at high broker prefetch (`TASK_PREFETCH`, default 16) per
  consumer, each on its own channel; the worker sizes its thread pool
  (`WORKER_THREADS`, default 64) so the concurrent sync-httpx handlers overlap
  their I/O rather than queueing on threads. Scale further with worker replicas
  (`docker compose up -d --scale ingest-worker=N`). The real ceiling is the
  downstream service (vision GPU / catalog), not the worker. No locks: bounds are
  `asyncio.Semaphore` (producer) + per-consumer prefetch (broker); blocking work
  is offloaded to the executor where the GIL is released.
- **The LLM (`label`) queue is a single, serial consumer**: prefetch 1 + an
  **exclusive consumer** (the broker rejects a second), so the single-threaded
  llama-server is never hit concurrently regardless of replica count. It runs on
  its own `ingest-worker-label` service (one replica) so its backlog never blocks
  the fast pool.
- **Producer knobs are live-tunable** from the settings panel: `ingest_concurrency`
  and `ingest_via_queue` are served by the ingest `GET/PUT /config` endpoint
  (in-memory overrides over env), read on each scan — no restart. Consumer
  prefetch + replicas are deploy-time (worker processes) and shown read-only.

### Reliability (unchanged shape from ADR 0001)

- Best-effort publish; catalog write is still the durability boundary.
- Per-queue TTL+DLX retry → per-queue `*.dlq`; uniform backoff.
- **Reconcile** becomes per-stage aware: probe catalog for a missing `embedding`
  blob → re-publish `embed.dense`; missing `sparse` blob → `embed.sparse`;
  missing search point → `index.search`; missing graph node → `index.graph`. It
  remains the safety net for publishes lost during a broker outage.
- **Label-backfill** re-publishes `label`.
- **Ledger** records each new task type; RabbitMQ stays the source of truth for
  outstanding work.

## Consequences

**Positive**
- Fast path parallel across `ingest` replicas → images visible asap *at scale*
  (closes the real gap).
- GPU work isolated in `embed.dense` → scale GPU pool independently; dense vector
  persisted and **reused**, eliminating ADR 0001's 2× dense embed.
- `embed.sparse` / `index.search` / `index.graph` scale independently; a relabel
  re-runs only the cheap legs, never the GPU.
- Fan-in needs no orchestration engine — catalog is the rendezvous.

**Negative / trade-offs**
- 6 queues (+ retry/dlq each) vs 2 → more topology to declare and observe; the
  queue page (#29) must render the new set.
- New catalog `sparse` blob kind + an extra catalog read on the `index.search`
  path.
- Eventual consistency widens slightly: a point can briefly hold one vector's
  worth of staleness until the sibling lands (converges on the second publish).
- More services to reason about, though all are one image behind `QUEUES`.

## Alternatives considered

- **Stay at ADR 0001's 2 queues, parallelize only the in-process fast path**
  (bounded `asyncio.gather`) — smallest change, but availability stays capped to
  one ingest process and the GPU stays coupled inside `index`. Rejected: doesn't
  meet "parallelize ingestion" at scale.
- **Real orchestration engine (Temporal/Prefect/Celery-canvas)** — owns the DAG,
  retries, and joins natively. Rejected: heavyweight for a single-box compose
  homelab; choreography + catalog-rendezvous gives the same DAG with no new
  runtime.
- **Fan-in via a join/counter table in catalog** — explicit rendezvous row per
  sha. Rejected: catalog *blob presence* already encodes completion, so a
  counter is redundant state to keep consistent.
- **Partial-vector upsert in search** (dense and sparse write their own named
  vector directly to Qdrant) — removes the catalog read on `index.search`, but
  reintroduces the search partial-update endpoint ADR 0001 avoided and a
  create-vs-update ordering race on the point. Deferred.
