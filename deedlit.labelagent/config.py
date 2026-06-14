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

# Hard cap on total generated tokens — the guaranteed backstop on thinking spend.
MAX_TOKENS = int(os.getenv("LABELAGENT_MAX_TOKENS", "1024"))

# Thinking-token budget forwarded to llama-server for reasoning models. There is
# no dedicated reasoning knob on OpenAILike/LlamaCpp, so this is passed through
# the request body; MAX_TOKENS remains the hard cap regardless.
THINKING_BUDGET = int(os.getenv("LABELAGENT_THINKING_BUDGET", "256"))
