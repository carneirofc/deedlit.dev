"""Read embedded metadata from PNG text chunks.

Ported faithfully from ``lib/png-metadata.ts``. The TS version streamed from a
file handle; this port operates on an in-memory ``bytes`` buffer because the
service receives multipart upload bytes. Chunk parsing, latin1/utf8 decoding,
zlib inflation, and the ``{source, fields}`` shape all match the TS behavior.
"""
from __future__ import annotations

import json
import struct
import zlib
from typing import Any

__all__ = ["read_embedded_metadata_from_png"]

PNG_SIGNATURE = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])


def _looks_like_json(value: str) -> bool:
    trimmed = value.strip()
    return trimmed.startswith("{") or trimmed.startswith("[")


def _parse_text_chunk(data: bytes) -> dict | None:
    separator = data.find(0)
    if separator <= 0:
        return None
    return {
        "keyword": data[:separator].decode("latin1"),
        "chunkType": "tEXt",
        "text": data[separator + 1 :].decode("latin1"),
    }


def _parse_ztxt_chunk(data: bytes) -> dict | None:
    separator = data.find(0)
    if separator <= 0 or separator + 2 > len(data):
        return None
    compression_method = data[separator + 1]
    if compression_method != 0:
        return None
    try:
        text = zlib.decompress(data[separator + 2 :]).decode("utf-8")
    except (zlib.error, UnicodeDecodeError):
        return None
    return {
        "keyword": data[:separator].decode("latin1"),
        "chunkType": "zTXt",
        "text": text,
    }


def _parse_itxt_chunk(data: bytes) -> dict | None:
    keyword_end = data.find(0)
    if keyword_end <= 0:
        return None

    offset = keyword_end + 1
    if offset + 2 > len(data):
        return None

    compression_flag = data[offset]
    compression_method = data[offset + 1]
    offset += 2

    language_tag_end = data.find(0, offset)
    if language_tag_end == -1:
        return None
    offset = language_tag_end + 1

    translated_keyword_end = data.find(0, offset)
    if translated_keyword_end == -1:
        return None
    offset = translated_keyword_end + 1

    text_data = data[offset:]
    if compression_flag == 1:
        if compression_method != 0:
            return None
        try:
            text_data = zlib.decompress(text_data)
        except zlib.error:
            return None

    try:
        text = text_data.decode("utf-8")
    except UnicodeDecodeError:
        return None

    return {
        "keyword": data[:keyword_end].decode("latin1"),
        "chunkType": "iTXt",
        "text": text,
    }


def _parse_chunk(chunk_type: str, data: bytes) -> dict | None:
    if chunk_type == "tEXt":
        return _parse_text_chunk(data)
    if chunk_type == "zTXt":
        return _parse_ztxt_chunk(data)
    if chunk_type == "iTXt":
        return _parse_itxt_chunk(data)
    return None


def _to_metadata_object(chunks: list[dict]) -> dict:
    fields: dict[str, Any] = {}
    for chunk in chunks:
        normalized_text = chunk["text"].strip()
        if _looks_like_json(normalized_text):
            try:
                parsed_value: Any = json.loads(normalized_text)
            except json.JSONDecodeError:
                parsed_value = normalized_text
        else:
            parsed_value = normalized_text

        existing = fields.get(chunk["keyword"], _MISSING)
        if existing is _MISSING:
            fields[chunk["keyword"]] = parsed_value
        elif isinstance(existing, list):
            existing.append(parsed_value)
        else:
            fields[chunk["keyword"]] = [existing, parsed_value]

    return {"source": "embedded-png", "fields": fields}


_MISSING = object()


def read_embedded_metadata_from_png(image_bytes: bytes) -> dict:
    """Return ``{"metadata": {...}}`` or ``{}`` (or ``{"error": msg}``)."""
    try:
        if len(image_bytes) < 8 or image_bytes[:8] != PNG_SIGNATURE:
            return {}

        chunks: list[dict] = []
        offset = 8
        total = len(image_bytes)
        found_iend = False

        while not found_iend:
            if offset + 8 > total:
                break
            (length,) = struct.unpack(">I", image_bytes[offset : offset + 4])
            chunk_type = image_bytes[offset + 4 : offset + 8].decode("ascii", "replace")

            if chunk_type in ("tEXt", "zTXt", "iTXt"):
                data = image_bytes[offset + 8 : offset + 8 + length]
                parsed = _parse_chunk(chunk_type, data)
                if parsed:
                    chunks.append(parsed)

            if chunk_type == "IEND":
                found_iend = True

            offset += 8 + length + 4

        return {"metadata": _to_metadata_object(chunks)} if chunks else {}
    except Exception as error:  # noqa: BLE001 - mirror TS catch-all
        return {"error": str(error) or "Unknown PNG metadata parse error"}
