# deedlit.vision — CLIP embedding service
#
# Requires NVIDIA GPU + nvidia-container-toolkit for CUDA inference.
# CPU fallback: set CLIP_DEVICE=cpu in docker-compose / environment.
#
# Build context: deedlit.vision/

FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-dev python3-pip curl \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.11 /usr/bin/python

# Install CUDA-capable PyTorch before the rest so other packages don't pull CPU
# wheels. cu128 (CUDA 12.8) wheels are REQUIRED for RTX 50-series / Blackwell
# (sm_120) GPUs: cu121 ships no sm_120 kernels and dies at inference with
# "no kernel image is available for execution on the device". Pinned to the same
# versions the local cu128 venv runs; mirrors the cu128 index in pyproject.toml.
RUN python3 -m pip install --no-cache-dir \
    "torch==2.11.0+cu128" \
    "torchvision==0.26.0+cu128" \
    --extra-index-url https://download.pytorch.org/whl/cu128

WORKDIR /app

# Install remaining dependencies (torch already satisfied above).
COPY pyproject.toml ./
RUN python3 -m pip install --no-cache-dir \
    "fastapi>=0.116.0" \
    "fastembed>=0.4.0" \
    "httpx>=0.27.0" \
    "open-clip-torch>=2.24.0" \
    "pillow>=10.0.0" \
    "pydantic>=2.11.0" \
    "python-multipart>=0.0.9" \
    "safetensors>=0.4.0" \
    "transformers>=4.40.0" \
    "uvicorn[standard]>=0.35.0" \
    "opentelemetry-distro>=0.48b0" \
    "opentelemetry-exporter-otlp-proto-http>=1.27.0" \
    "opentelemetry-instrumentation-fastapi>=0.48b0" \
    "opentelemetry-instrumentation-httpx>=0.48b0"

COPY app.py activity.py ./

# /comfyui is mounted from the host — see docker-compose COMFYUI_ROOT_HOST.
ENV COMFYUI_ROOT=/comfyui
ENV CLIP_DEVICE=cuda
ENV CLIP_MODEL_PRESET=vit_h
ENV CLIP_FP16=true

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --retries=10 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

# opentelemetry-instrument wraps uvicorn for zero-code tracing; OTEL_* env
# (endpoint/service name/protocol) is supplied by docker-compose.
CMD ["opentelemetry-instrument", "python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
