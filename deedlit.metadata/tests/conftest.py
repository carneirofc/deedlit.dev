"""Shared fixtures: build PNGs programmatically with Pillow so tests don't need
binary fixtures on disk."""
from __future__ import annotations

import io

import pytest
from PIL import Image
from PIL.PngImagePlugin import PngInfo


def make_png(text_chunks: dict[str, str], *, size=(4, 4), itxt=None, ztxt=None) -> bytes:
    """Build a tiny PNG carrying the given keyword->text tEXt chunks.

    ``ztxt``/``itxt`` (dict) add compressed chunks instead.
    """
    img = Image.new("RGB", size, (10, 20, 30))
    info = PngInfo()
    for k, v in text_chunks.items():
        info.add_text(k, v)
    for k, v in (ztxt or {}).items():
        info.add_text(k, v, zip=True)
    for k, v in (itxt or {}).items():
        info.add_itxt(k, v, zip=False)
    buf = io.BytesIO()
    img.save(buf, format="PNG", pnginfo=info)
    return buf.getvalue()


@pytest.fixture
def make_png_bytes():
    return make_png
