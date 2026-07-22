# contracts — OpenAPI Design Sketches

## Purpose
- Phase-0 OpenAPI 3.1 design sketches that ratify each service's HTTP surface — a shared reference, not a runtime dependency.

## Ownership
- Owns the `*.openapi.yaml` sketches and the cross-cutting invariant checks in `validate.py`.

## Local Contracts
- One sketch per surface: `api`, `catalog`, `graph`, `ingest`, `metadata`, `search`, `vision` (`.openapi.yaml`).
- These are NOT a source package. At runtime each FastAPI service serves its own authoritative `/openapi.json`; consumers generate typed clients from that live doc into `deedlit.<consumer>/clients/<provider>/`.
- `validate.py` validates every sketch as OpenAPI 3.1 and enforces two invariants: metadata's `References` must contain `checkpoints, loras, embeddings, vae, controlnets, upscalers`; search's `QueryResponse.fusion` enum must include `"rrf"`. Exit code 1 on any failure.
- All DTOs use the frozen id-scheme — see [`../id-scheme/`](../id-scheme/AGENTS.md).

## Work Guidance
- When a service's real surface changes, update its sketch here to match, and keep the `validate.py` invariants in sync.

## Verification
- `uv run --with openapi-spec-validator --with pyyaml python contracts/validate.py`

## Child Guides
- None.
