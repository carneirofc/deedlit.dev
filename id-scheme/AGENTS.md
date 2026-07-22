# id-scheme — Frozen Cross-Service Identity

## Purpose
- Freezes the single cross-service image identity: the canonical id is the SHA-256 hex of the raw image bytes, and the derived Qdrant point id is `uuid5(NAMESPACE, sha256-hex)`.

## Ownership
- Owns the spec (`README.md`) and the golden test vectors (`vectors.json`). No shared source package — each service carries its own copy of the helper.

## Local Contracts
- `NAMESPACE = 697124e2-0736-5d17-812d-590ba305cb45` is hard-coded and must NEVER change (derived from `uuid5(NAMESPACE_URL, "https://deedlit.dev/id-scheme/v1")`).
- `vectors.json` holds labeled test vectors (`empty`, `hello`, `deedlit`, `png-bytes-sample`) with `sha256`→`pointId` pairs every language copy must reproduce exactly.
- Copies: Python `id_scheme.py` in each FastAPI service (`ingest`, `vision`, `search`, `catalog`, …); TypeScript `deedlit.dev.comfyhelper/lib/library/id-scheme.ts`.

## Work Guidance
- Changing the id or namespace would orphan every stored id — it is frozen. Only add vectors; never alter `NAMESPACE` or existing pairs.

## Verification
- Each service's own unit tests exercise its copy against `vectors.json` (e.g. `deedlit.vision/tests/test_id_scheme.py`, `deedlit.dev.comfyhelper/tests/unit/id-scheme.unit.ts`). No standalone runner.

## Child Guides
- None.
