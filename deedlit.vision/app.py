from __future__ import annotations

if __import__("os").getenv("OTEL_TRACES_EXPORTER"):
    from opentelemetry.instrumentation.auto_instrumentation import initialize as _otel_initialize
    _otel_initialize()
    del _otel_initialize

import asyncio
import io
import logging
import os
import time
import warnings
from pathlib import Path
from typing import Annotated, Literal

# Keep HuggingFace strictly to "download the model only if required": no
# telemetry, no implicit-token lookups, and no noisy unauthenticated-request
# warnings at runtime. The vision tower already loads from local safetensors;
# only the text tower fetches from the Hub on first use, then it is cached.
# Set HF_HUB_OFFLINE=1 after that first download to disable all Hub network
# calls entirely. These must be set before huggingface_hub is imported.
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
warnings.filterwarnings("ignore", message=".*unauthenticated requests.*")
logging.getLogger("huggingface_hub.utils._http").setLevel(logging.ERROR)

import httpx
import open_clip
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field
from PIL import Image
from safetensors.torch import load_file
from torchvision import transforms
from transformers import CLIPVisionConfig, CLIPVisionModelWithProjection

from activity import install_activity


# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------
# Your ComfyUI root. Keep this absolute.
COMFYUI_ROOT = Path(
    os.getenv(
        "COMFYUI_ROOT",
        r"K:\comfyui\ComfyUI_windows_portable\ComfyUI",
    )
)

# Presets:
#   vit_h = lighter (1024-dim), better for always-on API
#   big_g = heavier (1280-dim), better quality candidate for offline indexing
# Both are loadable so consumers can compare the smaller vs larger embeddings.
# CLIP_MODEL_PRESET is the default used when a request omits `model`.
# CLIP_MODELS is the comma-separated set consumers may select (default: both).
DEFAULT_PRESET = os.getenv("CLIP_MODEL_PRESET", "vit_h").lower()
ENABLED_PRESETS = [p.strip().lower() for p in os.getenv("CLIP_MODELS", "vit_h,big_g").split(",") if p.strip()]

# Cosine: embeddings are L2-normalized, so dot product == cosine similarity.
# Reported to consumers so they configure Qdrant collections with the right metric.
EMBEDDING_DISTANCE = "Cosine"

DEVICE = os.getenv("CLIP_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
USE_FP16 = os.getenv("CLIP_FP16", "true").lower() == "true"

# Fail fast (at import, before uvicorn binds) if CUDA was explicitly requested
# but isn't actually usable — so a GPU deployment can never silently degrade to
# CPU. Without this, a torch build lacking kernels for the installed GPU (e.g.
# cu121 wheels on a Blackwell sm_120 card) still reports cuda.is_available()
# True, loads onto "cuda", and only blows up at the first matmul. Set
# CLIP_DEVICE=cpu to run on CPU intentionally.
if DEVICE.startswith("cuda") and not torch.cuda.is_available():
    raise RuntimeError(
        f"CLIP_DEVICE={DEVICE!r} requested CUDA but torch.cuda.is_available() is "
        f"False (torch {torch.__version__}, built for CUDA {torch.version.cuda}). "
        "Check the NVIDIA container runtime and that torch matches this GPU's "
        "compute capability. Set CLIP_DEVICE=cpu to run on CPU intentionally."
    )

# SPLADE sparse text embedding (lexical/term-weight vectors for hybrid search).
# Loaded lazily on the first /embed/sparse call, mirroring the CLIP towers.
# fastembed downloads the (small) ONNX model from the Hub on first use.
SPARSE_MODEL_NAME = os.getenv("SPARSE_MODEL", "prithivida/Splade_PP_en_v1")

# Standard CLIP image normalization (OpenAI dataset stats, used by OpenCLIP too).
CLIP_IMAGE_MEAN = (0.48145466, 0.4578275, 0.40821073)
CLIP_IMAGE_STD = (0.26862954, 0.26130258, 0.27577711)


MODEL_CONFIGS = {
    "vit_h": {
        "model_name": "ViT-H-14",
        "pretrained": "laion2b_s32b_b79k",
        "expected_dim": 1024,
        "local_safetensors": COMFYUI_ROOT
        / "models"
        / "clip_vision"
        / "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
        "vision_config": CLIPVisionConfig(
            hidden_size=1280,
            intermediate_size=5120,
            num_attention_heads=16,
            num_hidden_layers=32,
            patch_size=14,
            image_size=224,
            hidden_act="gelu",
            layer_norm_eps=1e-5,
            projection_dim=1024,
        ),
    },
    "big_g": {
        "model_name": "ViT-bigG-14",
        "pretrained": "laion2b_39b_b160k",
        "expected_dim": 1280,
        "local_safetensors": COMFYUI_ROOT
        / "models"
        / "clip_vision"
        / "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors",
        "vision_config": CLIPVisionConfig(
            hidden_size=1664,
            intermediate_size=8192,
            num_attention_heads=16,
            num_hidden_layers=48,
            patch_size=14,
            image_size=224,
            hidden_act="gelu",
            layer_norm_eps=1e-5,
            projection_dim=1280,
        ),
    },
}

if DEFAULT_PRESET not in MODEL_CONFIGS:
    raise RuntimeError(f"Invalid CLIP_MODEL_PRESET={DEFAULT_PRESET!r}. Use one of {list(MODEL_CONFIGS)}.")
for _preset in ENABLED_PRESETS:
    if _preset not in MODEL_CONFIGS:
        raise RuntimeError(f"Invalid preset in CLIP_MODELS: {_preset!r}. Known: {list(MODEL_CONFIGS)}.")
if DEFAULT_PRESET not in ENABLED_PRESETS:
    ENABLED_PRESETS.insert(0, DEFAULT_PRESET)

# Backward-compatible alias for "the default model" used where no model is selected.
CONFIG = MODEL_CONFIGS[DEFAULT_PRESET]


# ---------------------------------------------------------------------
# Optional Qdrant integration (consumed by the test UI only)
# ---------------------------------------------------------------------
# deedlit.vision is an embedding service; Qdrant is an external, optional
# dependency used purely so the test page can rank a query against a live
# collection. It is never required for the /embed/* and /similarity/* APIs.
# Defaults mirror deedlit.dev.comfyhelper so a co-located stack "just works".
QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333").rstrip("/")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "images")
QDRANT_TIMEOUT = float(os.getenv("QDRANT_TIMEOUT", "5.0"))
# deedlit.search owns the shared collection and configures NAMED vectors
# (dense + sparse), so a search must address the vector by name — a bare
# {"vector": [...]} query fails with "Not existing vector name". This is the
# dense vector to query from the test UI; it matches deedlit.search's name.
QDRANT_DENSE_VECTOR_NAME = os.getenv("QDRANT_DENSE_VECTOR_NAME", "dense")

# Backing-stack services from deedlit.dev.comfyhelper's docker-compose. Used only
# by the test UI's "Services" panel for reachability + console deep-links; none
# are required by the /embed/* API. Probe URLs default to the compose-mapped
# localhost ports; override per-env if deedlit.vision runs elsewhere.
QDRANT_DASHBOARD_URL = os.getenv("QDRANT_DASHBOARD_URL", f"{QDRANT_URL}/dashboard")
NEO4J_HTTP_URL = os.getenv("NEO4J_HTTP_URL", "http://localhost:7474").rstrip("/")
RUSTFS_S3_URL = os.getenv("RUSTFS_S3_URL", "http://localhost:9000").rstrip("/")
RUSTFS_CONSOLE_URL = os.getenv("RUSTFS_CONSOLE_URL", "http://localhost:9001").rstrip("/")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
SERVICE_TIMEOUT = float(os.getenv("SERVICE_TIMEOUT", "3.0"))

# Static UI served from disk so the (large) test page stays editable.
STATIC_DIR = Path(__file__).resolve().parent / "static"
INDEX_HTML = STATIC_DIR / "index.html"


# ---------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------
# Health probes are polled on a tight interval (Docker HEALTHCHECK + the status
# dashboard), so their access logs drown out everything else. Drop them from
# uvicorn's access log while leaving real traffic intact.
class _HealthAccessFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # uvicorn.access record args: (client, method, full_path, http_ver, status)
        if isinstance(args, tuple) and len(args) >= 3:
            return "/health" not in str(args[2])
        return True


logging.getLogger("uvicorn.access").addFilter(_HealthAccessFilter())

# Surface this service's own work logs (model loads + per-request embed timing)
# at INFO so the GPU's behaviour is visible — without this, a custom logger
# propagates to the WARNING-level root and stays hidden behind uvicorn's loggers.
# Set VISION_LOG_LEVEL=DEBUG for more detail.
log = logging.getLogger("deedlit.vision")
if not log.handlers:
    _vh = logging.StreamHandler()
    _vh.setFormatter(logging.Formatter("%(levelname)s:     [%(name)s] %(message)s"))
    log.addHandler(_vh)
    log.propagate = False
log.setLevel(os.getenv("VISION_LOG_LEVEL", "INFO").upper())

app = FastAPI(
    title="ComfyUI CLIP Embedding API",
    description=(
        "Small local API for generating CLIP/OpenCLIP embeddings from images and text. "
        "Designed for Qdrant image similarity and text-to-image search. "
        "Use `/similarity/*` for similarity endpoints; `/simillarity/*` remains "
        "available only as a deprecated compatibility alias."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    swagger_ui_parameters={"displayRequestDuration": True},
    openapi_tags=[
        {"name": "health", "description": "Runtime and model readiness checks."},
        {"name": "embeddings", "description": "Text and image embedding endpoints."},
        {"name": "similarity", "description": "Cosine-similarity ranking endpoints."},
        {"name": "qdrant", "description": "Optional search against a live Qdrant collection (used by the test UI)."},
        {"name": "services", "description": "Reachability of the backing data-stack services (used by the test UI)."},
    ],
)
install_activity(app)


class TextEmbeddingRequest(BaseModel):
    text: str = Field(..., description="Text to embed.", examples=["red-haired anime knight in gothic ruins"])
    model: str | None = Field(
        None, description="Model preset to use (`vit_h` or `big_g`). Omit for the server default."
    )

    model_config = {
        "json_schema_extra": {
            "examples": [{"text": "red-haired anime knight in gothic ruins"}],
        }
    }


class TextsEmbeddingRequest(BaseModel):
    texts: list[str] = Field(
        ...,
        min_length=1,
        description="One or more texts to embed, in order.",
        examples=[["a red sports car", "a bowl of fruit"]],
    )
    model: str | None = Field(
        None, description="Model preset to use (`vit_h` or `big_g`). Omit for the server default."
    )

    model_config = {
        "json_schema_extra": {
            "examples": [{"texts": ["a red sports car", "a bowl of fruit"]}],
        }
    }


class TextSimilarityRequest(BaseModel):
    reference: str = Field(..., description="Text to compare candidates against.", examples=["a red sports car"])
    candidates: list[str] = Field(
        ...,
        min_length=1,
        description="One or more texts to score against the reference.",
        examples=[["a blue sedan", "a bowl of fruit"]],
    )
    model: str | None = Field(
        None, description="Model preset to use (`vit_h` or `big_g`). Omit for the server default."
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "reference": "a red sports car",
                    "candidates": ["a blue sedan", "a bowl of fruit"],
                }
            ],
        }
    }


class SparseEmbeddingRequest(BaseModel):
    text: str = Field(..., description="Text to embed into a SPLADE sparse vector.", examples=["red-haired anime knight in gothic ruins"])

    model_config = {
        "json_schema_extra": {
            "examples": [{"text": "red-haired anime knight in gothic ruins"}],
        }
    }


class SparseEmbeddingResponse(BaseModel):
    model: str = Field(..., description="SPLADE model name used to produce the sparse vector.")
    indices: list[int] = Field(..., description="Vocabulary token ids with non-zero weight.")
    values: list[float] = Field(..., description="Term weight for each index, aligned with `indices`.")


class EmbeddingResponse(BaseModel):
    model_preset: str = Field(..., description="Configured CLIP_MODEL_PRESET (`vit_h` or `big_g`).")
    model_name: str = Field(..., description="OpenCLIP model architecture name.")
    device: str = Field(..., description="Torch device used (`cpu` or `cuda`).")
    dim: int = Field(..., description="Embedding vector length.")
    embedding: list[float] = Field(..., description="L2-normalized embedding vector.")


class EmbeddingResult(BaseModel):
    index: int = Field(..., description="Position of this item in the request, 0-based.")
    label: str = Field(..., description="Source text or uploaded filename for this item.")
    dim: int = Field(..., description="Embedding vector length.")
    embedding: list[float] = Field(..., description="L2-normalized embedding vector.")


class BatchEmbeddingResponse(BaseModel):
    model_preset: str = Field(..., description="Configured CLIP_MODEL_PRESET (`vit_h` or `big_g`).")
    model_name: str = Field(..., description="OpenCLIP model architecture name.")
    device: str = Field(..., description="Torch device used (`cpu` or `cuda`).")
    results: list[EmbeddingResult] = Field(..., description="One embedding per input, in request order.")


class SimilarityResult(BaseModel):
    index: int = Field(..., description="Position of this candidate in the request, 0-based.")
    label: str = Field(..., description="Candidate text or uploaded filename.")
    similarity: float = Field(..., description="Cosine similarity to the reference, in [-1, 1].")


class SimilarityResponse(BaseModel):
    model_preset: str = Field(..., description="Configured CLIP_MODEL_PRESET (`vit_h` or `big_g`).")
    model_name: str = Field(..., description="OpenCLIP model architecture name.")
    reference: str = Field(..., description="Reference text or uploaded filename that candidates were scored against.")
    results: list[SimilarityResult] = Field(
        ..., description="Candidates ranked by similarity to the reference, descending."
    )


class HealthResponse(BaseModel):
    status: Literal["ok"]
    model_preset: str = Field(..., description="Configured CLIP_MODEL_PRESET (`vit_h` or `big_g`).")
    model_name: str = Field(..., description="OpenCLIP model architecture name.")
    pretrained: str = Field(..., description="OpenCLIP pretrained tag for the text tower.")
    device: str = Field(..., description="Torch device used (`cpu` or `cuda`).")
    fp16: bool = Field(..., description="Whether half precision is active (requires CUDA + CLIP_FP16=true).")
    expected_dim: int = Field(..., description="Embedding vector length for this preset.")
    local_safetensors: str = Field(..., description="Path to the local ComfyUI clip_vision checkpoint for this preset.")
    local_safetensors_exists: bool = Field(..., description="Whether the local vision checkpoint file was found.")
    vision_ready: bool = Field(..., description="Whether the vision tower (image embeddings) is loaded.")
    text_ready: bool = Field(..., description="Whether the text tower (text embeddings) is loaded.")
    sparse_model: str = Field(..., description="SPLADE model name used for sparse text embeddings.")
    sparse_ready: bool = Field(..., description="Whether the SPLADE sparse text model is loaded.")


class QdrantStatusResponse(BaseModel):
    configured_url: str = Field(..., description="Qdrant base URL this service is configured to use.")
    collection: str = Field(..., description="Configured Qdrant collection name.")
    reachable: bool = Field(..., description="Whether the Qdrant HTTP API responded.")
    collection_exists: bool = Field(..., description="Whether the configured collection exists.")
    vector_size: int | None = Field(None, description="Vector dimensionality of the collection, if known.")
    distance: str | None = Field(None, description="Distance metric of the collection, if known.")
    points_count: int | None = Field(None, description="Number of points in the collection, if known.")
    model_dim: int = Field(..., description="Embedding dimensionality this model produces.")
    dim_matches: bool = Field(..., description="Whether the collection vector size matches this model's dim.")
    detail: str | None = Field(None, description="Human-readable explanation when search is unavailable.")


class QdrantTextSearchRequest(BaseModel):
    text: str = Field(..., description="Text query to embed and search.", examples=["anime knight in gothic ruins"])
    limit: int = Field(12, ge=1, le=100, description="Maximum number of hits to return.")
    model: str | None = Field(
        None, description="Model preset to embed the query with (`vit_h` or `big_g`). Omit for the server default."
    )


class QdrantSearchResult(BaseModel):
    id: str = Field(..., description="Qdrant point id.")
    score: float = Field(..., description="Similarity score returned by Qdrant.")
    payload: dict | None = Field(None, description="Stored point payload, if any.")


class QdrantSearchResponse(BaseModel):
    collection: str = Field(..., description="Collection that was searched.")
    query: str = Field(..., description="Text query or uploaded filename used for the search.")
    count: int = Field(..., description="Number of hits returned.")
    results: list[QdrantSearchResult] = Field(..., description="Hits ordered by score, descending.")


class ServiceStatus(BaseModel):
    key: str = Field(..., description="Stable identifier for the service.")
    name: str = Field(..., description="Display name.")
    reachable: bool = Field(..., description="Whether the service responded to a probe.")
    detail: str | None = Field(None, description="Human-readable status explanation.")
    console_url: str | None = Field(None, description="Web console/UI to open in a browser, if any.")
    info: str | None = Field(None, description="Short extra info (version, counts, endpoint).")


class ServicesStatusResponse(BaseModel):
    services: list[ServiceStatus] = Field(..., description="One entry per backing service.")


class ModelInfo(BaseModel):
    preset: str = Field(..., description="Preset key to pass as `model` on requests (`vit_h` / `big_g`).")
    model_name: str = Field(..., description="OpenCLIP architecture name.")
    pretrained: str = Field(..., description="OpenCLIP pretrained tag.")
    dim: int = Field(..., description="Embedding vector length / Qdrant collection vector size for this model.")
    distance: str = Field(..., description="Recommended Qdrant distance metric for these embeddings.")
    device: str = Field(..., description="Torch device used.")
    fp16: bool = Field(..., description="Whether half precision is active.")
    is_default: bool = Field(..., description="Whether this preset is used when a request omits `model`.")
    enabled: bool = Field(..., description="Whether consumers may select this preset.")
    local_safetensors: str = Field(..., description="Path to the local clip_vision checkpoint for this preset.")
    local_safetensors_exists: bool = Field(..., description="Whether the local vision checkpoint file was found.")
    vision_ready: bool = Field(..., description="Whether the vision tower is loaded for this preset.")
    text_ready: bool = Field(..., description="Whether the text tower is loaded for this preset.")


class SparseModelInfo(BaseModel):
    name: str = Field(..., description="SPLADE model name for sparse text embeddings.")
    ready: bool = Field(..., description="Whether the SPLADE sparse text model is loaded.")


class ModelsResponse(BaseModel):
    default_preset: str = Field(..., description="Preset used when a request omits `model`.")
    enabled_presets: list[str] = Field(..., description="Presets consumers may select via the `model` parameter.")
    device: str = Field(..., description="Torch device used for all models.")
    fp16: bool = Field(..., description="Whether half precision is active.")
    distance: str = Field(..., description="Recommended Qdrant distance metric for these embeddings.")
    models: list[ModelInfo] = Field(..., description="All known dense models with their settings and readiness.")
    sparse: SparseModelInfo = Field(..., description="SPLADE sparse text model name and readiness.")


# Per-preset model caches. Both presets can be loaded at once so consumers can
# compare the smaller (vit_h) and larger (big_g) embeddings; each loads lazily.
_vision_models: dict[str, CLIPVisionModelWithProjection] = {}
_vision_preprocess: dict[str, transforms.Compose] = {}
_text_models: dict[str, object] = {}
_tokenizers: dict[str, object] = {}

# SPLADE sparse text model. Single-element cache keyed by model name so the
# heavy fastembed import + ONNX model download happen only on first use.
_sparse_models: dict[str, object] = {}


def _normalize(x: torch.Tensor) -> torch.Tensor:
    return x / x.norm(dim=-1, keepdim=True)


def _cosine_similarity(a: torch.Tensor, b: torch.Tensor) -> float:
    return float((a.float() @ b.float()).item())


def _resolve_preset(model: str | None) -> str:
    """Validate a requested model and fall back to the default preset."""
    if model is None or not model.strip():
        return DEFAULT_PRESET
    preset = model.strip().lower()
    if preset not in MODEL_CONFIGS:
        raise HTTPException(status_code=400, detail=f"Unknown model {model!r}. Known: {list(MODEL_CONFIGS)}.")
    if preset not in ENABLED_PRESETS:
        raise HTTPException(
            status_code=400,
            detail=f"Model {preset!r} is not enabled. Enabled: {ENABLED_PRESETS} (set CLIP_MODELS to change).",
        )
    return preset


def _embed_text_vec(text: str, preset: str = DEFAULT_PRESET) -> torch.Tensor:
    _load_text_model(preset)

    tokens = _tokenizers[preset]([text]).to(DEVICE)

    with torch.no_grad():
        vec = _text_models[preset].encode_text(tokens)
        vec = _normalize(vec)

    return vec[0]


def _embed_image_vec(image: Image.Image, preset: str = DEFAULT_PRESET) -> torch.Tensor:
    _load_vision_model(preset)

    started = time.perf_counter()
    image_tensor = _vision_preprocess[preset](image).unsqueeze(0).to(DEVICE)

    if USE_FP16 and DEVICE.startswith("cuda"):
        image_tensor = image_tensor.half()

    with torch.no_grad():
        vec = _vision_models[preset](pixel_values=image_tensor).image_embeds
        vec = _normalize(vec)

    # Per-request GPU timing: if this is fast but ingest is slow, the bottleneck
    # is elsewhere (labelagent/metadata/network), not the CLIP forward pass.
    log.info(
        "embed image (%s) %.0f ms on %s%s",
        preset, (time.perf_counter() - started) * 1000, DEVICE,
        " fp16" if (USE_FP16 and DEVICE.startswith("cuda")) else "",
    )
    return vec[0]


async def _read_image_upload(file: UploadFile) -> Image.Image:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail=f"Expected image upload for {file.filename!r}, got content_type={file.content_type!r}",
        )

    raw = await file.read()

    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image {file.filename!r}: {exc}") from exc


def _load_vision_model(preset: str) -> None:
    """
    Load the CLIP vision tower + projection for ``preset`` directly from the
    ComfyUI clip_vision safetensors file (already on disk, no download).

    The ComfyUI clip_vision checkpoints use the same key layout as
    transformers' CLIPVisionModelWithProjection (`vision_model.*` and
    `visual_projection.weight`), so the state dict loads as-is.
    """
    if preset in _vision_models:
        return

    config = MODEL_CONFIGS[preset]
    local_path = config["local_safetensors"]
    if not local_path.exists():
        raise RuntimeError(f"Local clip_vision safetensors not found for {preset!r}: {local_path}")

    # Lazy first-use load (safetensors -> GPU) is a one-time multi-second cost
    # during which the GPU looks idle; log it so a slow first file is explained.
    log.info("loading CLIP vision tower %s onto %s …", preset, DEVICE)
    _load_started = time.perf_counter()

    m = CLIPVisionModelWithProjection(config["vision_config"])

    state_dict = load_file(str(local_path))
    state_dict.pop("vision_model.embeddings.position_ids", None)
    missing, unexpected = m.load_state_dict(state_dict, strict=False)
    if missing or unexpected:
        raise RuntimeError(
            f"Unexpected clip_vision state dict layout for {preset!r}. missing={missing} unexpected={unexpected}"
        )

    m = m.to(DEVICE).eval()

    if USE_FP16 and DEVICE.startswith("cuda"):
        m = m.half()

    _vision_models[preset] = m
    _vision_preprocess[preset] = transforms.Compose(
        [
            transforms.Resize(224, interpolation=transforms.InterpolationMode.BICUBIC),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=CLIP_IMAGE_MEAN, std=CLIP_IMAGE_STD),
        ]
    )
    log.info("loaded CLIP vision tower %s in %.0f ms", preset, (time.perf_counter() - _load_started) * 1000)


def _load_text_model(preset: str) -> None:
    """
    Load the OpenCLIP text tower + tokenizer for ``preset`` via open_clip's
    official model identifiers. Unlike the vision tower, no local checkpoint is
    available for this, so the first call downloads the full OpenCLIP checkpoint.
    """
    if preset in _text_models:
        return

    config = MODEL_CONFIGS[preset]
    m, _, _ = open_clip.create_model_and_transforms(
        config["model_name"],
        pretrained=config["pretrained"],
    )
    tok = open_clip.get_tokenizer(config["model_name"])

    m = m.to(DEVICE).eval()

    if USE_FP16 and DEVICE.startswith("cuda"):
        m = m.half()

    _text_models[preset] = m
    _tokenizers[preset] = tok


def _load_sparse_model() -> object:
    """
    Lazy-load the SPLADE sparse text model via fastembed. Like the text tower,
    no local checkpoint is available, so the first call downloads the (small)
    ONNX model from the Hub; it is then cached for the process lifetime.

    The fastembed import is deferred to here so the rest of the API (and the
    dense embedding paths) stay importable even if fastembed is unavailable.
    """
    if SPARSE_MODEL_NAME in _sparse_models:
        return _sparse_models[SPARSE_MODEL_NAME]

    from fastembed import SparseTextEmbedding

    _sparse_models[SPARSE_MODEL_NAME] = SparseTextEmbedding(model_name=SPARSE_MODEL_NAME)
    return _sparse_models[SPARSE_MODEL_NAME]


def _embed_sparse(text: str) -> tuple[list[int], list[float]]:
    """Return aligned (indices, values) plain-Python lists for one text.

    fastembed yields one ``SparseEmbedding`` per input, each exposing
    ``.indices`` and ``.values`` as numpy arrays; we convert to JSON-safe
    ``list[int]`` / ``list[float]``.
    """
    model = _load_sparse_model()
    embedding = next(iter(model.embed([text])))
    indices = [int(i) for i in embedding.indices.tolist()]
    values = [float(v) for v in embedding.values.tolist()]
    return indices, values


def _render_index() -> HTMLResponse:
    try:
        return HTMLResponse(INDEX_HTML.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=f"UI file missing: {INDEX_HTML}") from exc


@app.get("/", include_in_schema=False)
def api_home() -> HTMLResponse:
    return _render_index()


@app.get("/similarity", include_in_schema=False)
def similarity_home() -> HTMLResponse:
    return _render_index()


@app.get("/simillarity", include_in_schema=False)
def misspelled_similarity_home() -> RedirectResponse:
    return RedirectResponse(url="/similarity", status_code=307)


@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Service health and model status",
    response_description="Current model configuration and readiness.",
    operation_id="getHealth",
    tags=["health"],
    description=(
        "Reports the default model preset, device, and whether its vision and text "
        "towers are loaded. Models load lazily on first use so Swagger UI, ReDoc, the "
        "OpenAPI document, and the local test page remain available even before any "
        "weights are loaded. See `/models` for per-model settings and readiness."
    ),
)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model_preset=DEFAULT_PRESET,
        model_name=CONFIG["model_name"],
        pretrained=CONFIG["pretrained"],
        device=DEVICE,
        fp16=USE_FP16 and DEVICE.startswith("cuda"),
        expected_dim=CONFIG["expected_dim"],
        local_safetensors=str(CONFIG["local_safetensors"]),
        local_safetensors_exists=CONFIG["local_safetensors"].exists(),
        vision_ready=DEFAULT_PRESET in _vision_models,
        text_ready=DEFAULT_PRESET in _text_models,
        sparse_model=SPARSE_MODEL_NAME,
        sparse_ready=SPARSE_MODEL_NAME in _sparse_models,
    )


def _model_info(preset: str) -> ModelInfo:
    config = MODEL_CONFIGS[preset]
    local_path = config["local_safetensors"]
    return ModelInfo(
        preset=preset,
        model_name=config["model_name"],
        pretrained=config["pretrained"],
        dim=config["expected_dim"],
        distance=EMBEDDING_DISTANCE,
        device=DEVICE,
        fp16=USE_FP16 and DEVICE.startswith("cuda"),
        is_default=preset == DEFAULT_PRESET,
        enabled=preset in ENABLED_PRESETS,
        local_safetensors=str(local_path),
        local_safetensors_exists=local_path.exists(),
        vision_ready=preset in _vision_models,
        text_ready=preset in _text_models,
    )


@app.get(
    "/models",
    response_model=ModelsResponse,
    summary="Available models, settings, and readiness",
    response_description="Per-model settings (dim, distance, device) and load status for consumers.",
    operation_id="getModels",
    tags=["health"],
    description=(
        "Lists every known model with the settings a consumer needs to configure a vector "
        "store: `preset` (pass as the `model` parameter), `dim` (Qdrant vector size), and "
        "`distance` (Cosine). `enabled` marks which presets may be selected; `is_default` is "
        "used when a request omits `model`. Both the smaller (`vit_h`, 1024-dim) and larger "
        "(`big_g`, 1280-dim) models can be loaded at once for side-by-side comparison."
    ),
)
def models() -> ModelsResponse:
    return ModelsResponse(
        default_preset=DEFAULT_PRESET,
        enabled_presets=ENABLED_PRESETS,
        device=DEVICE,
        fp16=USE_FP16 and DEVICE.startswith("cuda"),
        distance=EMBEDDING_DISTANCE,
        models=[_model_info(p) for p in MODEL_CONFIGS],
        sparse=SparseModelInfo(
            name=SPARSE_MODEL_NAME,
            ready=SPARSE_MODEL_NAME in _sparse_models,
        ),
    )


@app.post(
    "/embed/text",
    response_model=EmbeddingResponse,
    summary="Embed one text",
    response_description="A single normalized text embedding.",
    operation_id="embedText",
    tags=["embeddings"],
    description="Encode a single text with the OpenCLIP text tower and return its L2-normalized embedding.",
)
def embed_text(request: TextEmbeddingRequest) -> EmbeddingResponse:
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    preset = _resolve_preset(request.model)
    vec = _embed_text_vec(request.text, preset)
    embedding = vec.float().cpu().tolist()

    return EmbeddingResponse(
        model_preset=preset,
        model_name=MODEL_CONFIGS[preset]["model_name"],
        device=DEVICE,
        dim=len(embedding),
        embedding=embedding,
    )


@app.post(
    "/embed/sparse",
    response_model=SparseEmbeddingResponse,
    summary="Sparse (SPLADE) embedding of text",
    response_description="A SPLADE sparse vector as aligned indices/values.",
    operation_id="embedSparse",
    tags=["embeddings"],
    description=(
        "Encode a single text into a SPLADE sparse vector for lexical / hybrid search. "
        "Returns aligned `indices` (vocabulary token ids) and `values` (term weights). "
        "The SPLADE model loads lazily on first use."
    ),
)
def embed_sparse(request: SparseEmbeddingRequest) -> SparseEmbeddingResponse:
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    indices, values = _embed_sparse(request.text)

    return SparseEmbeddingResponse(
        model=SPARSE_MODEL_NAME,
        indices=indices,
        values=values,
    )


@app.post(
    "/embed/texts",
    response_model=BatchEmbeddingResponse,
    summary="Embed multiple texts",
    response_description="One normalized text embedding per input.",
    operation_id="embedTexts",
    tags=["embeddings"],
    description="Encode one or more texts with the OpenCLIP text tower and return one L2-normalized embedding per text, in order.",
)
def embed_texts(request: TextsEmbeddingRequest) -> BatchEmbeddingResponse:
    preset = _resolve_preset(request.model)
    results = []
    for i, text in enumerate(request.texts):
        if not text.strip():
            raise HTTPException(status_code=400, detail=f"texts[{i}] cannot be empty.")
        vec = _embed_text_vec(text, preset)
        embedding = vec.float().cpu().tolist()
        results.append(EmbeddingResult(index=i, label=text, dim=len(embedding), embedding=embedding))

    return BatchEmbeddingResponse(
        model_preset=preset,
        model_name=MODEL_CONFIGS[preset]["model_name"],
        device=DEVICE,
        results=results,
    )


@app.post(
    "/embed/image",
    response_model=EmbeddingResponse,
    summary="Embed one image",
    response_description="A single normalized image embedding.",
    operation_id="embedImage",
    tags=["embeddings"],
    description="Upload a single image and return its L2-normalized CLIP vision embedding.",
)
async def embed_image(
    file: Annotated[UploadFile, File(description="Image file to embed.")],
    model: Annotated[str | None, Form(description="Model preset (`vit_h` or `big_g`). Omit for default.")] = None,
) -> EmbeddingResponse:
    preset = _resolve_preset(model)
    image = await _read_image_upload(file)
    vec = _embed_image_vec(image, preset)
    embedding = vec.float().cpu().tolist()

    return EmbeddingResponse(
        model_preset=preset,
        model_name=MODEL_CONFIGS[preset]["model_name"],
        device=DEVICE,
        dim=len(embedding),
        embedding=embedding,
    )


@app.post(
    "/embed/images",
    response_model=BatchEmbeddingResponse,
    summary="Embed multiple images",
    response_description="One normalized image embedding per upload.",
    operation_id="embedImages",
    tags=["embeddings"],
    description="Upload one or more image files and return one L2-normalized CLIP vision embedding per image, in order.",
)
async def embed_images(
    files: Annotated[list[UploadFile], File(description="One or more image files to embed.")],
    model: Annotated[str | None, Form(description="Model preset (`vit_h` or `big_g`). Omit for default.")] = None,
) -> BatchEmbeddingResponse:
    if not files:
        raise HTTPException(status_code=400, detail="files cannot be empty.")

    preset = _resolve_preset(model)
    results = []
    for i, file in enumerate(files):
        image = await _read_image_upload(file)
        vec = _embed_image_vec(image, preset)
        embedding = vec.float().cpu().tolist()
        results.append(
            EmbeddingResult(index=i, label=file.filename or f"image_{i}", dim=len(embedding), embedding=embedding)
        )

    return BatchEmbeddingResponse(
        model_preset=preset,
        model_name=MODEL_CONFIGS[preset]["model_name"],
        device=DEVICE,
        results=results,
    )


def _ranked_results(reference: torch.Tensor, candidates: list[tuple[str, torch.Tensor]]) -> list[SimilarityResult]:
    results = [
        SimilarityResult(index=i, label=label, similarity=_cosine_similarity(reference, vec))
        for i, (label, vec) in enumerate(candidates)
    ]
    return sorted(results, key=lambda r: r.similarity, reverse=True)


@app.post(
    "/similarity/text",
    response_model=SimilarityResponse,
    summary="Compare a text against other texts",
    response_description="Candidate texts ranked by cosine similarity.",
    operation_id="compareTextSimilarity",
    tags=["similarity"],
    description=(
        "Embed the reference text and each candidate text, then return the candidates "
        "ranked by cosine similarity to the reference (descending)."
    ),
)
def similarity_text(request: TextSimilarityRequest) -> SimilarityResponse:
    if not request.reference.strip():
        raise HTTPException(status_code=400, detail="reference cannot be empty.")
    if not request.candidates:
        raise HTTPException(status_code=400, detail="candidates cannot be empty.")

    preset = _resolve_preset(request.model)
    ref_vec = _embed_text_vec(request.reference, preset)

    candidates = []
    for i, text in enumerate(request.candidates):
        if not text.strip():
            raise HTTPException(status_code=400, detail=f"candidates[{i}] cannot be empty.")
        candidates.append((text, _embed_text_vec(text, preset)))

    return SimilarityResponse(
        model_preset=preset,
        model_name=MODEL_CONFIGS[preset]["model_name"],
        reference=request.reference,
        results=_ranked_results(ref_vec, candidates),
    )


@app.post(
    "/similarity/image",
    response_model=SimilarityResponse,
    summary="Compare an image against other images",
    response_description="Candidate images ranked by cosine similarity.",
    operation_id="compareImageSimilarity",
    tags=["similarity"],
    description=(
        "Embed the reference image and each candidate image, then return the candidates "
        "ranked by cosine similarity to the reference (descending). Pass one reference "
        "file field named `reference` and one or more candidate file fields named "
        "`candidates`."
    ),
)
async def similarity_image(
    reference: Annotated[
        UploadFile,
        File(description="Reference image to compare candidates against."),
    ],
    candidates: Annotated[
        list[UploadFile],
        File(description="One or more candidate images to score. Append each file with field name `candidates`."),
    ],
    model: Annotated[str | None, Form(description="Model preset (`vit_h` or `big_g`). Omit for default.")] = None,
) -> SimilarityResponse:
    if not candidates:
        raise HTTPException(status_code=400, detail="candidates cannot be empty.")

    preset = _resolve_preset(model)
    ref_image = await _read_image_upload(reference)
    ref_vec = _embed_image_vec(ref_image, preset)

    candidate_vecs = []
    for i, file in enumerate(candidates):
        image = await _read_image_upload(file)
        candidate_vecs.append((file.filename or f"candidate_{i}", _embed_image_vec(image, preset)))

    return SimilarityResponse(
        model_preset=preset,
        model_name=MODEL_CONFIGS[preset]["model_name"],
        reference=reference.filename or "reference",
        results=_ranked_results(ref_vec, candidate_vecs),
    )


@app.post(
    "/similarity/text-to-image",
    response_model=SimilarityResponse,
    summary="Compare a text against images",
    response_description="Candidate images ranked by similarity to the text.",
    operation_id="compareTextToImageSimilarity",
    tags=["similarity"],
    description=(
        "Embed the reference text and each candidate image, then return the images "
        "ranked by cosine similarity to the reference text (descending). Useful for "
        "text-to-image search. Submit the text field as `text` and each image file "
        "with field name `images`."
    ),
)
async def similarity_text_to_image(
    text: Annotated[str, Form(description="Reference text to compare images against.")],
    images: Annotated[
        list[UploadFile],
        File(description="One or more candidate images to score. Append each file with field name `images`."),
    ],
    model: Annotated[str | None, Form(description="Model preset (`vit_h` or `big_g`). Omit for default.")] = None,
) -> SimilarityResponse:
    if not text.strip():
        raise HTTPException(status_code=400, detail="text cannot be empty.")
    if not images:
        raise HTTPException(status_code=400, detail="images cannot be empty.")

    preset = _resolve_preset(model)
    ref_vec = _embed_text_vec(text, preset)

    candidate_vecs = []
    for i, file in enumerate(images):
        image = await _read_image_upload(file)
        candidate_vecs.append((file.filename or f"image_{i}", _embed_image_vec(image, preset)))

    return SimilarityResponse(
        model_preset=preset,
        model_name=MODEL_CONFIGS[preset]["model_name"],
        reference=text,
        results=_ranked_results(ref_vec, candidate_vecs),
    )


@app.post("/simillarity/text", response_model=SimilarityResponse, include_in_schema=False)
def misspelled_similarity_text(request: TextSimilarityRequest) -> SimilarityResponse:
    return similarity_text(request)


@app.post("/simillarity/image", response_model=SimilarityResponse, include_in_schema=False)
async def misspelled_similarity_image(
    reference: Annotated[UploadFile, File(description="Reference image to compare candidates against.")],
    candidates: Annotated[list[UploadFile], File(description="One or more candidate images to score.")],
) -> SimilarityResponse:
    return await similarity_image(reference, candidates)


@app.post("/simillarity/text-to-image", response_model=SimilarityResponse, include_in_schema=False)
async def misspelled_similarity_text_to_image(
    text: Annotated[str, Form(description="Reference text to compare images against.")],
    images: Annotated[list[UploadFile], File(description="One or more candidate images to score.")],
) -> SimilarityResponse:
    return await similarity_text_to_image(text, images)


# ---------------------------------------------------------------------
# Optional Qdrant search (test UI only)
# ---------------------------------------------------------------------
def _extract_vector_params(vectors: object) -> tuple[int | None, str | None, str | None]:
    """Pull (size, distance, name) from a Qdrant collection's vectors config.

    Handles both the unnamed default vector (``{"size": .., "distance": ..}`` →
    name ``None``) and named-vector maps (``{"dense": {"size": ..}}`` → that
    name). For a named map we prefer the configured dense vector and otherwise
    fall back to the first named config. ``name`` is ``None`` only for an unnamed
    (legacy single-vector) collection.
    """
    if not isinstance(vectors, dict):
        return None, None, None
    if "size" in vectors:
        return vectors.get("size"), vectors.get("distance"), None
    name = (
        QDRANT_DENSE_VECTOR_NAME
        if QDRANT_DENSE_VECTOR_NAME in vectors
        else next(iter(vectors), None)
    )
    cfg = vectors.get(name) if name is not None else None
    if isinstance(cfg, dict) and "size" in cfg:
        return cfg.get("size"), cfg.get("distance"), name
    return None, None, name


async def _fetch_qdrant_status(preset: str = DEFAULT_PRESET) -> QdrantStatusResponse:
    model_dim = MODEL_CONFIGS[preset]["expected_dim"]
    status = QdrantStatusResponse(
        configured_url=QDRANT_URL,
        collection=QDRANT_COLLECTION,
        reachable=False,
        collection_exists=False,
        vector_size=None,
        distance=None,
        points_count=None,
        model_dim=model_dim,
        dim_matches=False,
        detail=None,
    )

    url = f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}"
    try:
        async with httpx.AsyncClient(timeout=QDRANT_TIMEOUT) as client:
            resp = await client.get(url)
    except httpx.HTTPError as exc:
        status.detail = f"Qdrant not reachable at {QDRANT_URL} ({exc.__class__.__name__})."
        return status

    status.reachable = True
    if resp.status_code == 404:
        status.detail = f"Connected to {QDRANT_URL}, but collection {QDRANT_COLLECTION!r} does not exist."
        return status
    if resp.status_code >= 400:
        status.detail = f"Qdrant returned HTTP {resp.status_code} for collection {QDRANT_COLLECTION!r}."
        return status

    result = resp.json().get("result", {}) or {}
    status.collection_exists = True
    status.points_count = result.get("points_count")
    vectors = (((result.get("config") or {}).get("params") or {}).get("vectors"))
    size, distance, _name = _extract_vector_params(vectors)
    status.vector_size = size
    status.distance = distance
    status.dim_matches = size == model_dim
    if size is not None and not status.dim_matches:
        status.detail = (
            f"Collection {QDRANT_COLLECTION!r} is {size}-dim ({distance}); model is "
            f"{model_dim}-dim. Rebuild the collection with deedlit.vision embeddings to enable search."
        )
    return status


async def _resolve_search_vector_name() -> str | None:
    """Which named vector to query, or ``None`` for an unnamed collection.

    deedlit.search owns the shared collection with NAMED vectors (dense+sparse),
    so the test-UI search must address the dense vector by name. Only a legacy
    single-vector (unnamed) collection yields ``None``. On any read failure we
    assume the named dense vector — that's the current architecture, and a wrong
    guess surfaces as the real Qdrant error rather than a silent empty result.
    """
    url = f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}"
    try:
        async with httpx.AsyncClient(timeout=QDRANT_TIMEOUT) as client:
            resp = await client.get(url)
        resp.raise_for_status()
    except httpx.HTTPError:
        return QDRANT_DENSE_VECTOR_NAME
    result = resp.json().get("result", {}) or {}
    vectors = (((result.get("config") or {}).get("params") or {}).get("vectors"))
    _size, _distance, name = _extract_vector_params(vectors)
    return name


async def _qdrant_search(vector: list[float], limit: int, preset: str = DEFAULT_PRESET) -> list[QdrantSearchResult]:
    status = await _fetch_qdrant_status(preset)
    if not status.reachable:
        raise HTTPException(status_code=503, detail=status.detail or "Qdrant not reachable.")
    if not status.collection_exists:
        raise HTTPException(status_code=404, detail=status.detail or "Qdrant collection not found.")
    if not status.dim_matches:
        raise HTTPException(status_code=409, detail=status.detail or "Qdrant collection vector size mismatch.")

    url = f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/search"
    # Named-vector collections require the query vector to be addressed by name;
    # an unnamed (legacy) collection takes the bare list.
    name = await _resolve_search_vector_name()
    query_vector: object = {"name": name, "vector": vector} if name else vector
    payload = {"vector": query_vector, "limit": limit, "with_payload": True}
    try:
        async with httpx.AsyncClient(timeout=QDRANT_TIMEOUT) as client:
            resp = await client.post(url, json=payload)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Qdrant search failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Qdrant search returned HTTP {resp.status_code}: {resp.text[:200]}")

    hits = resp.json().get("result", []) or []
    return [
        QdrantSearchResult(id=str(h.get("id")), score=float(h.get("score", 0.0)), payload=h.get("payload"))
        for h in hits
    ]


@app.get(
    "/qdrant/status",
    response_model=QdrantStatusResponse,
    summary="Qdrant availability and collection compatibility",
    response_description="Whether Qdrant is reachable and its collection is searchable with this model.",
    operation_id="getQdrantStatus",
    tags=["qdrant"],
    description=(
        "Probe the configured Qdrant collection. Never errors on a down Qdrant: returns "
        "`reachable=false` so callers (the test UI) can degrade gracefully. `dim_matches` "
        "reports whether the collection's vector size equals the selected model's embedding dim."
    ),
)
async def qdrant_status(model: str | None = None) -> QdrantStatusResponse:
    return await _fetch_qdrant_status(_resolve_preset(model))


@app.post(
    "/qdrant/search/text",
    response_model=QdrantSearchResponse,
    summary="Search Qdrant by text query",
    response_description="Collection points ranked by similarity to the embedded text.",
    operation_id="searchQdrantByText",
    tags=["qdrant"],
    description=(
        "Embed the text with the OpenCLIP text tower and search the configured Qdrant "
        "collection. Returns 409 if the collection vector size does not match this model."
    ),
)
async def qdrant_search_text(request: QdrantTextSearchRequest) -> QdrantSearchResponse:
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="text cannot be empty.")
    preset = _resolve_preset(request.model)
    vector = _embed_text_vec(request.text, preset).float().cpu().tolist()
    results = await _qdrant_search(vector, request.limit, preset)
    return QdrantSearchResponse(
        collection=QDRANT_COLLECTION,
        query=request.text,
        count=len(results),
        results=results,
    )


@app.post(
    "/qdrant/search/image",
    response_model=QdrantSearchResponse,
    summary="Search Qdrant by image",
    response_description="Collection points ranked by similarity to the embedded image.",
    operation_id="searchQdrantByImage",
    tags=["qdrant"],
    description=(
        "Embed the uploaded image with the CLIP vision tower and search the configured "
        "Qdrant collection. Returns 409 if the collection vector size does not match this model."
    ),
)
async def qdrant_search_image(
    file: Annotated[UploadFile, File(description="Image to embed and search with.")],
    limit: Annotated[int, Form(ge=1, le=100, description="Maximum number of hits to return.")] = 12,
    model: Annotated[str | None, Form(description="Model preset (`vit_h` or `big_g`). Omit for default.")] = None,
) -> QdrantSearchResponse:
    preset = _resolve_preset(model)
    image = await _read_image_upload(file)
    vector = _embed_image_vec(image, preset).float().cpu().tolist()
    results = await _qdrant_search(vector, limit, preset)
    return QdrantSearchResponse(
        collection=QDRANT_COLLECTION,
        query=file.filename or "image",
        count=len(results),
        results=results,
    )


# ---------------------------------------------------------------------
# Backing-stack service reachability (test UI only)
# ---------------------------------------------------------------------
async def _probe_http(url: str) -> tuple[bool, int | None, str | None]:
    """GET a URL; return (responded, status_code, error_class)."""
    try:
        async with httpx.AsyncClient(timeout=SERVICE_TIMEOUT) as client:
            resp = await client.get(url)
        return True, resp.status_code, None
    except httpx.HTTPError as exc:
        return False, None, exc.__class__.__name__


async def _probe_neo4j() -> ServiceStatus:
    try:
        async with httpx.AsyncClient(timeout=SERVICE_TIMEOUT) as client:
            resp = await client.get(NEO4J_HTTP_URL + "/")
    except httpx.HTTPError as exc:
        return ServiceStatus(
            key="neo4j", name="Neo4j", reachable=False,
            detail=f"Not reachable at {NEO4J_HTTP_URL} ({exc.__class__.__name__}).",
            console_url=NEO4J_HTTP_URL,
        )
    info = None
    if resp.status_code < 400:
        try:
            data = resp.json()
            ver = data.get("neo4j_version") or data.get("version")
            if ver:
                info = f"v{ver}"
        except Exception:
            pass
    return ServiceStatus(
        key="neo4j", name="Neo4j", reachable=True, info=info, console_url=NEO4J_HTTP_URL,
        detail="Neo4j Browser available." if resp.status_code < 400 else f"HTTP {resp.status_code}.",
    )


async def _probe_qdrant_service() -> ServiceStatus:
    s = await _fetch_qdrant_status()
    if not s.reachable:
        return ServiceStatus(
            key="qdrant", name="Qdrant", reachable=False,
            detail=s.detail, console_url=QDRANT_DASHBOARD_URL,
        )
    if s.collection_exists:
        pts = s.points_count if s.points_count is not None else "?"
        info = f"{s.collection}: {pts} pts · {s.vector_size}d {s.distance or ''}".strip()
    else:
        info = f"collection {s.collection!r} missing"
    return ServiceStatus(
        key="qdrant", name="Qdrant", reachable=True,
        detail=s.detail or "Vector DB serving.", info=info, console_url=QDRANT_DASHBOARD_URL,
    )


async def _probe_rustfs() -> ServiceStatus:
    responded, status_code, err = await _probe_http(RUSTFS_S3_URL)
    if not responded:
        return ServiceStatus(
            key="rustfs", name="RustFS", reachable=False,
            detail=f"S3 API not reachable at {RUSTFS_S3_URL} ({err}).",
            console_url=RUSTFS_CONSOLE_URL,
        )
    # The S3 API answers 403 to an anonymous GET; any HTTP response means it is serving.
    return ServiceStatus(
        key="rustfs", name="RustFS", reachable=True,
        detail="S3 API serving.", info=f"S3 {RUSTFS_S3_URL}", console_url=RUSTFS_CONSOLE_URL,
    )


async def _probe_postgres() -> ServiceStatus:
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(POSTGRES_HOST, POSTGRES_PORT), timeout=SERVICE_TIMEOUT
        )
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return ServiceStatus(
            key="postgres", name="PostgreSQL", reachable=True,
            detail="TCP port open (no web console).",
            info=f"{POSTGRES_HOST}:{POSTGRES_PORT}", console_url=None,
        )
    except (OSError, asyncio.TimeoutError) as exc:
        return ServiceStatus(
            key="postgres", name="PostgreSQL", reachable=False,
            detail=f"TCP {POSTGRES_HOST}:{POSTGRES_PORT} closed ({exc.__class__.__name__}).",
            console_url=None,
        )


@app.get(
    "/services/status",
    response_model=ServicesStatusResponse,
    summary="Backing data-stack service reachability",
    response_description="Reachability + console links for Neo4j, Qdrant, PostgreSQL, and RustFS.",
    operation_id="getServicesStatus",
    tags=["services"],
    description=(
        "Probe the backing services from the comfyhelper docker-compose stack. Probes run "
        "concurrently with a short timeout and never error on a down service. Intended for "
        "the test UI's service dashboard; not required by the embedding API."
    ),
)
async def services_status() -> ServicesStatusResponse:
    services = await asyncio.gather(
        _probe_neo4j(),
        _probe_qdrant_service(),
        _probe_postgres(),
        _probe_rustfs(),
    )
    return ServicesStatusResponse(services=list(services))
