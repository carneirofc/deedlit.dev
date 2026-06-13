# HTTP contracts (OpenAPI sketches)

Phase-0 design sketches for the seven deedlit service surfaces. They are **design
artifacts**, not a shared source package: at runtime each provider serves its own
authoritative `/openapi.json` (FastAPI-generated), and consumers generate typed
clients from that live document into `deedlit.<consumer>/clients/<provider>/`.
These sketches exist to ratify the surface area before implementation.

All DTOs use the frozen [id scheme](../id-scheme/README.md): the `sha256` hex of the
image bytes is the cross-service id; the Qdrant point id is `uuid5(NAMESPACE, sha256)`.

| Surface           | Sketch                          | Store            |
|-------------------|---------------------------------|------------------|
| `deedlit.vision`  | [vision](vision.openapi.yaml)   | none (GPU)       |
| `deedlit.metadata`| [metadata](metadata.openapi.yaml) | none           |
| `deedlit.catalog` | [catalog](catalog.openapi.yaml) | Postgres + RustFS |
| `deedlit.search`  | [search](search.openapi.yaml)   | Qdrant           |
| `deedlit.graph`   | [graph](graph.openapi.yaml)     | Neo4j            |
| `deedlit.ingest`  | [ingest](ingest.openapi.yaml)   | none (worker)    |
| `deedlit.api`     | [api](api.openapi.yaml)         | none (gateway)   |
