"""deedlit.labelagent — Agno AgentOS image-labeling/description service.

Serves the labeling :data:`agent` (a vision LLM on a local llama-server) via
Agno's AgentOS control plane, plus a small ``POST /describe`` route the ingest
pipeline calls per image. Output is a structured ``{label, description, tags}``
used to enrich semantic indexing — the description feeds the sparse embedding
and the search-point payload over in deedlit.ingest.

Run (matches the sibling services): ``uvicorn app:app --port 8006``. AgentOS's
``get_app()`` returns a real FastAPI app, so our routes attach to it directly.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time

from agno.media import Image
from agno.os import AgentOS
from fastapi import File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from activity import install_activity
from agent import ImageLabel, agent


# Health probes are polled on a tight interval (Docker HEALTHCHECK + the status
# dashboard), so their access logs drown out everything else. Drop them from
# uvicorn's access log while leaving real traffic intact. (Mirrors deedlit.ingest.)
class _HealthAccessFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # uvicorn.access record args: (client, method, full_path, http_ver, status)
        if isinstance(args, tuple) and len(args) >= 3:
            path = str(args[2])
            return "/health" not in path and "/activity" not in path
        return True


logging.getLogger("uvicorn.access").addFilter(_HealthAccessFilter())

# Surface this service's own logs (per-image labeling timing) at INFO — the
# label stage drives a vision LLM and is a common ingest bottleneck, so its
# duration should be visible. Without an explicit handler a custom logger
# propagates to the WARNING-level root and stays hidden. LABELAGENT_LOG_LEVEL
# overrides (DEBUG for more).
log = logging.getLogger("deedlit.labelagent")
if not log.handlers:
    _lh = logging.StreamHandler()
    _lh.setFormatter(logging.Formatter("%(levelname)s:     [%(name)s] %(message)s"))
    log.addHandler(_lh)
    log.propagate = False
log.setLevel(os.getenv("LABELAGENT_LOG_LEVEL", "INFO").upper())

agent_os = AgentOS(name="deedlit.labelagent", agents=[agent])
app = agent_os.get_app()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
install_activity(app)


# Map an upload content-type to the format hint Agno's Image expects.
_FORMAT_FOR_MIME = {
    "image/png": "png",
    "image/webp": "webp",
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
}


def _format_for(content_type: str | None) -> str:
    if not content_type:
        return "png"
    return _FORMAT_FOR_MIME.get(content_type.split(";")[0].strip().lower(), "png")


# The content-safety classes the catalog/search/UI agree on (mirror agent.Safety).
_SAFETY_CLASSES = ("sfw", "nsfw", "explicit")
# Off-enum synonyms a local GGUF might emit, mapped onto the contract class.
_SAFETY_ALIASES = {
    "safe": "sfw",
    "clean": "sfw",
    "general": "sfw",
    "g": "sfw",
    "pg": "sfw",
    "questionable": "nsfw",
    "suggestive": "nsfw",
    "mature": "nsfw",
    "r": "nsfw",
    "18+": "nsfw",
    "hardcore": "explicit",
    "porn": "explicit",
    "pornographic": "explicit",
    "xxx": "explicit",
    "x": "explicit",
}


def _coerce_safety(value: object) -> str:
    """Normalize the model's safety value to exactly one of the contract classes.

    Local GGUFs don't honor a provider structured-output API, so ``safety`` can
    come back with odd casing/whitespace or an out-of-enum synonym. Map it onto
    sfw/nsfw/explicit; anything unrecognized defaults to the LOWER class (``sfw``)
    — both to match the agent's "when in doubt, choose lower" instruction and,
    critically, so a bad string can't make the label task raise and dead-letter
    (which would leave the image with NO detected safety class).
    """
    s = str(value or "").strip().lower()
    if s in _SAFETY_CLASSES:
        return s
    return _SAFETY_ALIASES.get(s, "sfw")


def _coerce_label(content: object) -> dict:
    """Coerce arbitrary agent output into a valid ImageLabel-shaped dict.

    ``agent.run`` may yield the parsed ImageLabel, a plain dict, or — when the
    GGUF's JSON-mode completion fails to parse into the schema — a raw string.
    Salvage all three (parse a JSON string; otherwise keep the prose as the
    description) and always emit a valid ``safety`` so the label task produces a
    usable, persistable result instead of raising on malformed model output.
    """
    if hasattr(content, "model_dump"):  # ImageLabel (output_schema)
        data = content.model_dump()
    elif isinstance(content, dict):
        data = dict(content)
    else:
        text = str(content or "").strip()
        data = {}
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                data = parsed
        except (ValueError, TypeError):
            pass
        if not data:
            # Unparseable completion: keep the raw text as the description so the
            # image is still labeled/searchable, with a safe default class.
            data = {"description": text}
    return {
        "label": str(data.get("label") or ""),
        "description": str(data.get("description") or ""),
        "tags": [str(t) for t in (data.get("tags") or []) if str(t).strip()],
        "safety": _coerce_safety(data.get("safety")),
    }


def run_label(data: bytes, fmt: str, prompt_hint: str | None = None) -> dict:
    """Run the agent over one image and return ``{label, description, tags, safety}``.

    This is the agent boundary — monkeypatched in tests so the suite stays
    offline (no llama-server required). Output is normalized via
    :func:`_coerce_label` so a malformed/off-enum completion still yields a valid
    label (and safety class) rather than raising.
    """
    user_msg = "Label and describe this image."
    if prompt_hint:
        user_msg += f" Generation prompt for context (may be inaccurate): {prompt_hint}"
    # The vision-LLM call is the slow part of the ingest `label` stage; time it so
    # a slow/overloaded llama-server is obvious in the log (and explains an ingest
    # that crawls while the CLIP GPU sits idle).
    log.info("labeling image (%d bytes, %s) …", len(data), fmt)
    started = time.perf_counter()
    resp = agent.run(user_msg, images=[Image(content=data, format=fmt)])
    log.info("labeled image in %.0f ms", (time.perf_counter() - started) * 1000)
    return _coerce_label(resp.content)


@app.post("/describe", response_model=ImageLabel, tags=["labelagent"])
async def describe(
    file: UploadFile = File(...),
    prompt_hint: str | None = Form(default=None),
) -> ImageLabel:
    """Label + describe one uploaded image for semantic indexing."""
    data = await file.read()
    # run_label drives a BLOCKING, synchronous vision-LLM call (agent.run) that can
    # take many seconds. Offload it to a worker thread so a slow llama-server
    # inference can't stall the event loop — otherwise this service can't answer
    # /health (the dashboard/HEALTHCHECK poll) or a concurrent /describe while one
    # image is being labeled.
    result = await asyncio.to_thread(
        run_label, data, _format_for(file.content_type), prompt_hint
    )
    return ImageLabel(**result)


# AgentOS already serves GET /health (matched first); this is a guaranteed
# fallback returning the same {"status": "ok"} shape the healthcheck/dashboard
# expect, so the probe survives any change to AgentOS's built-in route.
@app.get("/health", tags=["labelagent"])
def health() -> dict:
    return {"status": "ok"}
