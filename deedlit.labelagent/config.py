"""deedlit.labelagent configuration — all overridable via env (matches the
sibling services' plain-os.getenv style)."""
from __future__ import annotations

import os

# Local llama-server (llama.cpp), OpenAI-compatible `/v1` endpoint. In Docker the
# host's llama-server is reached via host.docker.internal (see docker-compose).
LLM_BASE_URL = os.getenv("LABELAGENT_LLM_BASE_URL", "http://127.0.0.1:8888/v1")

# llama-server serves whatever GGUF is loaded, so the id is mostly cosmetic — but
# the OpenAI client requires one. Must be a VISION-capable model for image input.
MODEL_ID = os.getenv("LABELAGENT_MODEL_ID", "local-vlm")

# llama-server ignores the key, but the OpenAI client rejects an empty one.
API_KEY = os.getenv("LABELAGENT_API_KEY", "sk-no-key")

TEMPERATURE = float(os.getenv("LABELAGENT_TEMPERATURE", "0.2"))

# Before handing an image to the vision LLM, downscale it to fit within this many
# pixels on its longest edge and re-encode it as LOSSLESS WebP. A multi-megapixel
# source is far more detail than the model needs to caption/tag it, and the
# encoded image becomes tokens in the model's context — so a smaller image cuts
# the per-image context (and latency) with no loss of labeling quality. ~1024px
# is plenty for describing/tagging. Set VISION_MAX_DIM <= 0 to disable downscaling
# and pass the original bytes through unchanged.
VISION_MAX_DIM = int(os.getenv("LABELAGENT_VISION_MAX_DIM", "1024"))

# Lossless-WebP compression effort (0-100): higher squeezes smaller at the cost of
# encode time; it does NOT affect image fidelity (encoding is pixel-exact, so the
# model sees identical pixels regardless). Default 90 trims nearly as small as
# 100 at a fraction of the encode time. The codec choice (WebP vs PNG) and this
# knob only affect transfer bytes, never the vision model's perception or its
# token/context cost — that's governed by VISION_MAX_DIM.
VISION_WEBP_EFFORT = int(os.getenv("LABELAGENT_VISION_WEBP_EFFORT", "90"))

# NOTE: generation length and the thinking/reasoning budget are intentionally NOT
# set here. This is a thinking model, and a client-side hard token cap truncated
# the structured JSON output (breaking every label). Let llama-server's own
# defaults govern length/thinking; configure them on the server if needed.
