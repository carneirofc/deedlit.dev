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
  GET  /jobs/{id}         -> Job
  POST /jobs/{id}/cancel  -> Job (cancelling)
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from jobs import JobStore

store = JobStore()


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.start_worker()
    yield


app = FastAPI(title="deedlit.ingest", version="0.1.0", lifespan=lifespan)


class IngestRequest(BaseModel):
    folderPath: str


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
