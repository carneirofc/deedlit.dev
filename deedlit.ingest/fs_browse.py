"""Server-side filesystem browser backing the admin directory picker.

Ingestion runs HERE — on the ingest worker's host — and needs an *absolute*
filesystem path (e.g. ``K:/comfyui/output``). The UI cannot produce one from a
browser file input, so the directory picker navigates this host's filesystem
through ``GET /fs/browse`` instead.

This intentionally exposes the whole filesystem: it mirrors the trust model the
ingest endpoints already establish (``/ingest`` happily walks any path the
caller provides). It is read-only — directory listing only.

Ported from the Next.js ``fs-browse-service.ts`` that lived in comfyhelper
before the service decomposition (#17); the logic now runs on the host that
actually owns the ingest filesystem rather than the UI host.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import TypedDict


class FsEntry(TypedDict):
    name: str
    path: str
    isDirectory: bool


class FsRoot(TypedDict):
    label: str
    path: str


class FsBrowseResult(TypedDict):
    # Absolute path being listed, or None for the synthetic "roots" view.
    path: str | None
    # Parent directory, or None when already at a drive/filesystem root.
    parent: str | None
    separator: str
    entries: list[FsEntry]
    # Quick-access jump targets (drives, home, cwd) shown in every view.
    roots: list[FsRoot]


class FsBrowseError(Exception):
    """A user-correctable filesystem error (missing/denied/not-a-dir).

    The route maps this to a 400 so the picker can show it inline rather than
    treating it as a server fault.
    """


# Cap listing size so pathological directories cannot bloat the response.
MAX_ENTRIES = 2000


def _windows_drives() -> list[FsRoot]:
    """Probe drive letters C..Z on Windows.

    A: and B: are skipped on purpose — legacy floppy letters can stall the probe
    for seconds when no media is present.
    """
    roots: list[FsRoot] = []
    for letter in "CDEFGHIJKLMNOPQRSTUVWXYZ":
        root = f"{letter}:\\"
        if os.path.exists(root):
            roots.append({"label": root, "path": root})
    return roots


def _quick_roots() -> list[FsRoot]:
    roots: list[FsRoot] = []
    if os.name == "nt":
        roots.extend(_windows_drives())
    else:
        roots.append({"label": "/", "path": "/"})

    home = os.path.expanduser("~")
    if home and home != "~":
        roots.append({"label": "Home", "path": home})
    roots.append({"label": "App dir", "path": os.getcwd()})

    seen: set[str] = set()
    deduped: list[FsRoot] = []
    for root in roots:
        if root["path"] in seen:
            continue
        seen.add(root["path"])
        deduped.append(root)
    return deduped


def _friendly_error(exc: OSError, target: str) -> FsBrowseError:
    if isinstance(exc, FileNotFoundError):
        return FsBrowseError(f"Folder not found: {target}")
    if isinstance(exc, NotADirectoryError):
        return FsBrowseError(f"Not a folder: {target}")
    if isinstance(exc, PermissionError):
        return FsBrowseError(f"Permission denied: {target}")
    return FsBrowseError(str(exc) or f"Cannot open {target}")


def browse_directory(target: str | None) -> FsBrowseResult:
    """List the directory at ``target``.

    A null/empty ``target`` returns the synthetic roots view (drive letters on
    Windows, ``/`` on POSIX, plus home & cwd). Raises :class:`FsBrowseError` for
    user-correctable filesystem failures.
    """
    roots = _quick_roots()

    if not target or not target.strip():
        return {
            "path": None,
            "parent": None,
            "separator": os.sep,
            "entries": [
                {"name": r["label"], "path": r["path"], "isDirectory": True}
                for r in roots
            ],
            "roots": roots,
        }

    resolved = os.path.abspath(target.strip())

    try:
        with os.scandir(resolved) as it:
            dirents = list(it)
    except OSError as exc:
        raise _friendly_error(exc, resolved) from exc

    entries: list[FsEntry] = []
    for dirent in dirents:
        try:
            is_dir = dirent.is_dir()
        except OSError:
            # A broken symlink or inaccessible entry: treat it as a file rather
            # than failing the whole listing.
            is_dir = False
        entries.append(
            {"name": dirent.name, "path": dirent.path, "isDirectory": is_dir}
        )
        if len(entries) >= MAX_ENTRIES:
            break

    # Directories first, then files; case-insensitive alphabetical within each.
    entries.sort(key=lambda e: (not e["isDirectory"], e["name"].casefold()))

    parent_dir = os.path.dirname(resolved)
    parent = None if parent_dir == resolved else parent_dir

    return {
        "path": resolved,
        "parent": parent,
        "separator": os.sep,
        "entries": entries,
        "roots": roots,
    }
