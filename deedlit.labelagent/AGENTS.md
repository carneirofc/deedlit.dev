# deedlit.labelagent — Vision-LLM Labeling

## Purpose
- FastAPI service (port 8006, Agno AgentOS): produces structured `{label, description, tags, safety}` for one image, consumed by the ingest `label` stage to enrich semantic search.

## Ownership
- Stateless — a thin wrapper around a local `llama-server`.

## Local Contracts
- Canonical HTTP contract: [`../contracts/`](../contracts/) surface via ingest; endpoints: `POST /describe` (multipart `file` + optional `prompt_hint` → `ImageLabel`), `GET /health`, plus AgentOS routes.
- `agent.py` defines the `ImageLabel` schema, `Safety` literal, and `build_model()` wiring; `config.py` holds env-driven knobs. `run_label` is the mockable seam so tests stay offline.
- External dependency: a vision-capable GGUF served by a local OpenAI-compatible `llama-server` at `LABELAGENT_LLM_BASE_URL` (default `http://127.0.0.1:8888/v1`). Single-threaded — ingest consumes the `label` queue serially.

## Work Guidance
- Keep the llama-server contract behind `run_label`; downscale/re-encode images (pillow) before sending to the VLM.

## Verification
- `uv run --directory deedlit.labelagent pytest`

## Child DOX Index
- None.
