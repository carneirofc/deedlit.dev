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

# Install CUDA-capable PyTorch before the rest so other packages don't pull CPU wheels.
RUN python3 -m pip install --no-cache-dir \
    "torch==2.2.0+cu121" \
    "torchvision==0.17.0+cu121" \
    --extra-index-url https://download.pytorch.org/whl/cu121

WORKDIR /app

# Install remaining dependencies (torch already satisfied above).
COPY pyproject.toml ./
RUN python3 -m pip install --no-cache-dir \
    "fastapi>=0.116.0" \
    "httpx>=0.27.0" \
    "open-clip-torch>=2.24.0" \
    "pillow>=10.0.0" \
    "pydantic>=2.11.0" \
    "python-multipart>=0.0.9" \
    "safetensors>=0.4.0" \
    "transformers>=4.40.0" \
    "uvicorn[standard]>=0.35.0"

COPY app.py .

# /comfyui is mounted from the host — see docker-compose COMFYUI_ROOT_HOST.
ENV COMFYUI_ROOT=/comfyui
ENV CLIP_DEVICE=cuda
ENV CLIP_MODEL_PRESET=vit_h
ENV CLIP_FP16=true

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --retries=10 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
