"""_downscale_for_vlm: shrink + WebP-recompress an image before the vision LLM.

These exercise the real PIL path (unlike test_describe, which stubs run_label),
so they confirm a large source is downscaled to fit VISION_MAX_DIM and re-encoded
as WebP — and that the helper degrades gracefully on junk input.
"""
from __future__ import annotations

import io

import pytest
from PIL import Image as PILImage

import app as app_module


def _png_bytes(w: int, h: int, color=(120, 40, 200)) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def _dims(data: bytes) -> tuple[int, int]:
    return PILImage.open(io.BytesIO(data)).size


def test_large_image_is_downscaled_to_max_dim_and_webp():
    big = _png_bytes(4000, 2000)
    out, fmt = app_module._downscale_for_vlm(big, "png")
    assert fmt == "webp"
    assert max(_dims(out)) == app_module.VISION_MAX_DIM  # longest edge clamped
    assert _dims(out)[0] / _dims(out)[1] == pytest.approx(2.0, abs=0.01)  # aspect kept
    assert len(out) < len(big)


def test_small_image_is_not_upscaled():
    small = _png_bytes(64, 48)
    out, fmt = app_module._downscale_for_vlm(small, "png")
    # Never enlarge — dimensions stay as-is even though we may re-encode to WebP.
    assert _dims(out) == (64, 48)


def test_alpha_is_flattened_onto_white_not_black():
    buf = io.BytesIO()
    # Fully transparent RGBA — flattening must yield white, not the PIL default black.
    PILImage.new("RGBA", (10, 10), (0, 0, 0, 0)).save(buf, format="PNG")
    out, fmt = app_module._downscale_for_vlm(buf.getvalue(), "png")
    px = PILImage.open(io.BytesIO(out)).convert("RGB").getpixel((5, 5))
    assert px == (255, 255, 255)


def test_disabled_when_max_dim_non_positive(monkeypatch):
    monkeypatch.setattr(app_module, "VISION_MAX_DIM", 0)
    big = _png_bytes(4000, 2000)
    out, fmt = app_module._downscale_for_vlm(big, "png")
    assert (out, fmt) == (big, "png")  # passthrough, untouched


def test_corrupt_input_falls_back_to_original():
    junk = b"\x89PNG\r\n\x1a\n-not-a-real-image"
    out, fmt = app_module._downscale_for_vlm(junk, "png")
    assert (out, fmt) == (junk, "png")  # never raises; labeling proceeds
