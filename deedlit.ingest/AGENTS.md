# deedlit.ingest — Ingest DAG Orchestrator

## Purpose
- FastAPI service (port 8004) + a separate worker process: scans source image files (hash / dims / thumbnail / metadata) and drives a fully queue-based per-stage DAG that fans results out to catalog, search, and graph.

## Ownership
- Stateless — holds no datastore. It is the sole publisher into RabbitMQ's per-stage task queues; job/task history is best-effort written through to catalog (`job_ledger.py` / `ledger.py`).

## Local Contracts
- Canonical HTTP contract: [`../contracts/ingest.openapi.yaml`](../contracts/ingest.openapi.yaml).
- Two processes, one image: `app.py` (HTTP surface + in-memory `JobStore`, run via uvicorn) and `worker.py` (AMQP consumer, run via `python worker.py` / `npm run dev:ingest-worker`).
- `broker.py` is the only AMQP seam (topology, publish, retry/DLQ, `run_worker`); `aio-pika` is imported lazily so tests run offline. `pipeline.py` holds per-file/per-stage logic and the outbound HTTP calls; `jobs.py`, `config.py` (live-tunable producer knobs), `fs_browse.py`, `settings_client.py`, `id_scheme.py`.
- Queue topics (routing key = queue name), each with `.retry` + `.dlq` siblings: `ingest`, `embed.dense`, `embed.sparse`, `index.search` (fan-in), `index.graph`, `label`. The `label` queue is serial (`LABEL_PREFETCH = 1`, exclusive) because the vision-LLM is single-threaded.
- Outbound calls: `metadata` `/extract`, `vision` `/embed/image` + `/embed/sparse`, optional `labelagent` `/describe` (gated by `LABELAGENT_URL`), plus catalog/search/graph writes.
- Design of record: [`../docs/adr/0001-async-queues-for-labelling-and-indexing.md`](../docs/adr/0001-async-queues-for-labelling-and-indexing.md) and [`0002-per-stage-ingest-dag.md`](../docs/adr/0002-per-stage-ingest-dag.md). RabbitMQ is a hard dependency (no inline fast path).

## Work Guidance
- Catalog write is the durability boundary and the rendezvous latch; stages persist to catalog then publish successors (choreography, no orchestrator). `index.search` upserts only once both dense + sparse blobs are present in catalog.

## Verification
- `uv run --directory deedlit.ingest pytest`

## Child DOX Index
- None.
