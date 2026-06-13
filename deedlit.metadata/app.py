"""deedlit.metadata — stateless metadata extraction (no DB).

Exposes ``GET /health`` and ``POST /extract``. ``/extract`` parses embedded PNG
text chunks (A1111 ``parameters`` / ComfyUI node graph) into a typed payload.
Pixel work (sha256/phash/dims/thumbnail) is NOT done here — ingest owns it.
The ``references{}`` field is deferred to #7 (always empty here).
See contracts/metadata.openapi.yaml.
"""
from fastapi import FastAPI, File, HTTPException, UploadFile

from extract import interpret_metadata
from png_metadata import read_embedded_metadata_from_png

app = FastAPI(title="deedlit.metadata", version="0.1.0")


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
