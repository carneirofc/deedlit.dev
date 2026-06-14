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

# NOTE: generation length and the thinking/reasoning budget are intentionally NOT
# set here. This is a thinking model, and a client-side hard token cap truncated
# the structured JSON output (breaking every label). Let llama-server's own
# defaults govern length/thinking; configure them on the server if needed.
