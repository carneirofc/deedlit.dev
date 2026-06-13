"""deedlit.ingest — stateless ingest/index worker (no DB).

FastAPI worker that owns write/index orchestration (moved out of the Next.js
app). Per-file pipeline computes sha256/phash/dims/WebP-thumbnail, calls
``metadata`` + ``vision`` (dense + sparse), assembles a record, and fans the
writes out to the TS app's write endpoints (catalog-first, per-store retry).

The job model is IN-MEMORY (the service holds no DB driver) with an async
claim/worker loop. Direct fan-out to catalog/search/graph is deferred to #17.

Endpoints (see contracts/ingest.openapi.yaml):
  GET  /health
  POST /ingest            {folderPath} -> Job (202)
  POST /jobs              MaintenanceRequest{type, sha256?} -> Job (202)
  GET  /jobs/{id}         -> Job
  POST /jobs/{id}/cancel  -> Job (cancelling)

Maintenance jobs (POST /jobs) reuse the SAME in-memory Job model + async worker
loop as /ingest, so they report progress and are cancellable like a normal
ingest job.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, model_validator

from jobs import REINDEX_ONE_IMAGE, JobStore

store = JobStore()


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.start_worker()
    yield


app = FastAPI(title="deedlit.ingest", version="0.1.0", lifespan=lifespan)


class IngestRequest(BaseModel):
    folderPath: str


class MaintenanceRequest(BaseModel):
    """POST /jobs body (mirrors contracts/ingest.openapi.yaml).

    ``type`` is a closed enum; ``sha256`` is required (and must be 64 lowercase
    hex chars) only for ``reindex-one-image``. ``folderPath`` optionally overrides
    the library root walked by ``rescan-files``.
    """

    type: Literal[
        "reindex-one-image",
        "rescan-files",
        "rebuild-search",
        "rebuild-graph",
        "rebuild-thumbnails",
    ]
    sha256: str | None = None
    folderPath: str | None = None

    @model_validator(mode="after")
    def _check_required(self) -> "MaintenanceRequest":
        if self.type == REINDEX_ONE_IMAGE:
            if not self.sha256:
                raise ValueError("sha256 is required for reindex-one-image")
            import re

            if not re.fullmatch(r"[a-f0-9]{64}", self.sha256):
                raise ValueError("sha256 must be 64 lowercase hex characters")
        return self


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/ingest", status_code=202)
def start_ingest(req: IngestRequest) -> JSONResponse:
    # Ensure the worker is running even outside the lifespan (e.g. TestClient
    # contexts that reuse the app); start_worker is idempotent.
    store.start_worker()
    job = store.create_ingest_job(req.folderPath)
    return JSONResponse(status_code=202, content=job.to_dict())


@app.post("/jobs", status_code=202)
def start_maintenance(req: MaintenanceRequest) -> JSONResponse:
    # Idempotent; see start_ingest for why this is called here too.
    store.start_worker()
    job = store.create_maintenance_job(
        req.type, sha256=req.sha256, folder_path=req.folderPath
    )
    return JSONResponse(status_code=202, content=job.to_dict())


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job.to_dict()


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    job = store.request_cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job.to_dict()
