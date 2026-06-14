"""deedlit.metadata — stateless metadata extraction (no DB).

Exposes ``GET /health`` and ``POST /extract``. ``/extract`` parses embedded PNG
text chunks (A1111 ``parameters`` / ComfyUI node graph) into a typed payload.
Pixel work (sha256/phash/dims/thumbnail) is NOT done here — ingest owns it.
The ``references{}`` field is deferred to #7 (always empty here).
See contracts/metadata.openapi.yaml.
"""
if __import__("os").getenv("OTEL_TRACES_EXPORTER"):
    from opentelemetry.instrumentation.auto_instrumentation import initialize as _otel_initialize
    _otel_initialize()
    del _otel_initialize

import logging

from fastapi import FastAPI, File, HTTPException, UploadFile

from activity import install_activity
from extract import interpret_metadata
from png_metadata import read_embedded_metadata_from_png


# Health probes are polled on a tight interval (Docker HEALTHCHECK + the status
# dashboard), so their access logs drown out everything else. Drop them from
# uvicorn's access log while leaving real traffic intact.
class _HealthAccessFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # uvicorn.access record args: (client, method, full_path, http_ver, status)
        if isinstance(args, tuple) and len(args) >= 3:
            path = str(args[2])
            return "/health" not in path and "/activity" not in path
        return True


logging.getLogger("uvicorn.access").addFilter(_HealthAccessFilter())

app = FastAPI(title="deedlit.metadata", version="0.1.0")
install_activity(app)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/extract")
async def extract(file: UploadFile = File(...)) -> dict:
    image_bytes = await file.read()
    embedded = read_embedded_metadata_from_png(image_bytes)
    metadata = embedded.get("metadata")

    result = interpret_metadata(metadata)
    if result["sourceTool"] == "unknown":
        raise HTTPException(status_code=422, detail="No recognized image metadata")
    return result
