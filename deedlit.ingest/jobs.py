"""In-memory job model + async claim/worker loop.

deedlit.ingest is stateless and holds NO DB driver, so the job registry lives in
process memory. A single async worker loop claims queued jobs and runs them to
completion, updating progress counters as it goes. Cancellation is cooperative:
the worker checks a per-job flag between files.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import pipeline

# Job lifecycle states (mirrors contracts/ingest.openapi.yaml).
QUEUED = "queued"
RUNNING = "running"
COMPLETED = "completed"
FAILED = "failed"
CANCELLED = "cancelled"

# Root walked by the ``rescan-files`` maintenance job when no folderPath is
# given. Mirrors the monolith's IMAGE_LIBRARY_ROOT.
LIBRARY_ROOT = os.getenv("IMAGE_LIBRARY_ROOT", os.path.join("data", "library"))

# Maintenance job types (mirrors MaintenanceRequest.type in the contract).
REINDEX_ONE_IMAGE = "reindex-one-image"
RESCAN_FILES = "rescan-files"
REBUILD_SEARCH = "rebuild-search"
REBUILD_GRAPH = "rebuild-graph"
REBUILD_THUMBNAILS = "rebuild-thumbnails"

# Reconcile sweep (issue #21): compare catalog coverage against the search and
# graph projections and repair drift via the rebuild-from-catalog paths. Backs
# the eventual-consistency guarantees of the fan-out write model.
RECONCILE = "reconcile"

# When the number of drifted images for a projection is at or below this, repair
# them one-by-one (cheaper, targeted) instead of a full collection rebuild.
RECONCILE_PER_IMAGE_MAX = int(os.getenv("RECONCILE_PER_IMAGE_MAX", "10"))

# rebuild-* -> the TS app maintenance endpoint each one drives (this phase).
# Re-pointing these directly at search/graph/object-store is deferred to #17.
REBUILD_ENDPOINTS = {
    REBUILD_SEARCH: "/api/library/maintenance/rebuild-qdrant",
    REBUILD_GRAPH: "/api/library/maintenance/rebuild-neo4j",
    REBUILD_THUMBNAILS: "/api/library/maintenance/regenerate-thumbnails",
}


@dataclass
class Progress:
    total: int = 0
    done: int = 0
    skipped: int = 0
    failed: int = 0


@dataclass
class Job:
    id: str
    type: str
    status: str = QUEUED
    progress: Progress = field(default_factory=Progress)
    error: str | None = None
    # Inputs / control (not serialized to the API).
    folder_path: str | None = None
    sha256: str | None = None
    rebuild_path: str | None = None
    per_image_max: int | None = None
    cancel_requested: bool = False
    # Reconcile output: per-image projection status + repair summary (#21).
    report: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "progress": asdict(self.progress),
            "error": self.error,
        }
        if self.report is not None:
            out["report"] = self.report
        return out


class JobStore:
    """Process-local registry + single-worker claim loop."""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        # sha256 seen across this process's lifetime — the dedup memory. A real
        # dedup would query catalog; in-memory keeps the stateless service honest
        # while still skipping unchanged files on a re-run within the process.
        self._seen_sha256: set[str] = set()
        self._worker: asyncio.Task | None = None

    # -- registry ---------------------------------------------------------
    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def create_ingest_job(self, folder_path: str) -> Job:
        job = Job(id=str(uuid.uuid4()), type="ingest", folder_path=folder_path)
        self._jobs[job.id] = job
        self._queue.put_nowait(job.id)
        return job

    def _enqueue(self, job: Job) -> Job:
        self._jobs[job.id] = job
        self._queue.put_nowait(job.id)
        return job

    def create_maintenance_job(
        self, mtype: str, *, sha256: str | None = None, folder_path: str | None = None
    ) -> Job:
        """Create a maintenance job. The worker dispatches on ``job.type``.

        Maintenance jobs reuse the SAME in-memory Job model + async worker loop
        as ``ingest`` (issue #9), so they get progress counters and cooperative
        cancellation for free.

          - reindex-one-image: re-run the per-file pipeline for one sha256.
          - rescan-files: walk the library root (or an explicit folder) and
            ingest new/changed files (reuses the #9 folder pipeline).
          - rebuild-search/graph/thumbnails: drive the corresponding rebuild via
            the TS app maintenance endpoint (this phase; see REBUILD_ENDPOINTS).
        """
        job = Job(id=str(uuid.uuid4()), type=mtype)
        if mtype == REINDEX_ONE_IMAGE:
            job.sha256 = sha256
        elif mtype == RESCAN_FILES:
            job.folder_path = folder_path or LIBRARY_ROOT
        elif mtype in REBUILD_ENDPOINTS:
            job.rebuild_path = REBUILD_ENDPOINTS[mtype]
        elif mtype == RECONCILE:
            return self.create_reconcile_job()
        return self._enqueue(job)

    def create_reconcile_job(self, *, per_image_max: int | None = None) -> Job:
        """Create a reconcile sweep job (issue #21).

        Compares catalog coverage against the search and graph projections and
        repairs drift via the rebuild-from-catalog paths. Reuses the in-memory
        Job model + async worker loop, so it gets progress + cooperative cancel.
        """
        job = Job(id=str(uuid.uuid4()), type=RECONCILE)
        job.per_image_max = (
            RECONCILE_PER_IMAGE_MAX if per_image_max is None else per_image_max
        )
        return self._enqueue(job)

    def request_cancel(self, job_id: str) -> Job | None:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        job.cancel_requested = True
        # A queued-but-not-started job can be cancelled immediately.
        if job.status == QUEUED:
            job.status = CANCELLED
        return job

    # -- worker -----------------------------------------------------------
    def start_worker(self) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run_worker())

    async def _run_worker(self) -> None:
        while True:
            job_id = await self._queue.get()
            job = self._jobs.get(job_id)
            try:
                if job is not None and job.status != CANCELLED:
                    await self._run_job(job)
            finally:
                self._queue.task_done()

    async def _run_job(self, job: Job) -> None:
        if job.cancel_requested:
            job.status = CANCELLED
            return
        job.status = RUNNING
        try:
            if job.type == REINDEX_ONE_IMAGE:
                await self._run_reindex_one(job)
            elif job.type == RECONCILE:
                await self._run_reconcile(job)
            elif job.type in REBUILD_ENDPOINTS:
                await self._run_rebuild(job)
            else:
                # "ingest" and "rescan-files" both walk a folder and run the
                # per-file pipeline — rescan-files reuses the #9 folder pipeline.
                await self._run_folder(job)
        except Exception as exc:  # folder missing, image not found, etc.
            if job.status not in (CANCELLED,):
                job.status = FAILED
                job.error = str(exc)

    async def _run_folder(self, job: Job) -> None:
        files = _list_supported_files(job.folder_path or "")
        job.progress.total = len(files)
        for path in files:
            if job.cancel_requested:
                job.status = CANCELLED
                return
            await self._process_one(job, path)
        job.status = COMPLETED

    async def _run_reindex_one(self, job: Job) -> None:
        """Re-run the per-file pipeline for a single already-cataloged image.

        Fetches the image's raw bytes from the app by sha256, runs the full
        pipeline, and fans out the writes — the same path a fresh ingest takes,
        but bypassing the dedup memory so the record is always refreshed.
        """
        job.progress.total = 1
        if job.cancel_requested:
            job.status = CANCELLED
            return
        sha256 = job.sha256 or ""
        data, mime = await asyncio.to_thread(pipeline.fetch_image_bytes, sha256)
        filename = f"{sha256}{_ext_for_mime(mime)}"
        if job.cancel_requested:
            job.status = CANCELLED
            return
        rec = await asyncio.to_thread(pipeline.process_file, data, filename)
        await asyncio.to_thread(pipeline.fan_out_writes, rec)
        self._seen_sha256.add(rec.sha256)
        job.progress.done += 1
        job.status = COMPLETED

    async def _run_rebuild(self, job: Job) -> None:
        """Drive a store rebuild via the TS app maintenance endpoint.

        The rebuild itself is a single opaque unit of work owned by the store
        (this phase); the ingest job wraps it so it gets the standard lifecycle
        (queued/running/completed + cancellable while queued).
        """
        job.progress.total = 1
        if job.cancel_requested:
            job.status = CANCELLED
            return
        await asyncio.to_thread(pipeline.trigger_rebuild, job.rebuild_path or "")
        job.progress.done += 1
        job.status = COMPLETED

    async def _run_reconcile(self, job: Job) -> None:
        """Reconcile sweep: catalog coverage vs search + graph projections (#21).

        Steps:
          1. list every sha256 the catalog holds (the set that SHOULD project);
          2. probe which of those the search and graph projections cover;
          3. compute drift (catalog-present-but-missing-in-{search,graph});
          4. repair drift via the rebuild-from-catalog paths — a full collection
             rebuild when many images drift, or targeted per-image reindex when
             only a few do (<= job.per_image_max);
          5. record a per-image projection status report on the job.

        Progress counts catalog images probed. Cancellation is checked between
        images (probing) and is honoured before the repair phase.
        """
        per_image_max = (
            RECONCILE_PER_IMAGE_MAX if job.per_image_max is None else job.per_image_max
        )

        catalog = await asyncio.to_thread(pipeline.list_catalog_sha256)
        job.progress.total = len(catalog)

        images: dict[str, dict[str, Any]] = {}
        search_drift: list[str] = []
        graph_drift: list[str] = []

        # -- coverage probe (per catalog image) --
        for sha in catalog:
            if job.cancel_requested:
                job.status = CANCELLED
                return
            in_search = await asyncio.to_thread(pipeline.search_has, sha)
            in_graph = await asyncio.to_thread(pipeline.graph_has, sha)
            images[sha] = {"in_search": in_search, "in_graph": in_graph, "repaired": False}
            if not in_search:
                search_drift.append(sha)
            if not in_graph:
                graph_drift.append(sha)
            job.progress.done += 1

        if job.cancel_requested:
            job.status = CANCELLED
            return

        # -- repair drift via rebuild-from-catalog paths --
        repaired: set[str] = set()
        strategy = "none"
        drift_images = set(search_drift) | set(graph_drift)
        total_drift_images = len(drift_images)

        if total_drift_images == 0:
            strategy = "none"
        elif total_drift_images <= per_image_max:
            # Targeted, image-by-image repair (cheaper than a full rebuild).
            # A single reindex re-projects BOTH search + graph for that image.
            strategy = "per-image"
            for sha in sorted(drift_images):
                if job.cancel_requested:
                    job.status = CANCELLED
                    return
                await asyncio.to_thread(pipeline.reindex_image, sha)
                images[sha]["repaired"] = True
                repaired.add(sha)
        else:
            # Full collection rebuild-from-catalog for any drifting projection.
            strategy = "rebuild"
            if search_drift:
                await asyncio.to_thread(pipeline.rebuild_search)
                for sha in search_drift:
                    images[sha]["repaired"] = True
                    repaired.add(sha)
            if graph_drift:
                await asyncio.to_thread(pipeline.rebuild_graph)
                for sha in graph_drift:
                    images[sha]["repaired"] = True
                    repaired.add(sha)

        job.report = {
            "catalog_count": len(catalog),
            "search_drift": search_drift,
            "graph_drift": graph_drift,
            "repaired": sorted(repaired),
            "repair_strategy": strategy,
            "images": images,
        }
        job.status = COMPLETED

    async def _process_one(self, job: Job, path: Path) -> None:
        try:
            data = await asyncio.to_thread(path.read_bytes)
            sha256 = pipeline.compute_sha256(data)
            if sha256 in self._seen_sha256:
                job.progress.skipped += 1
                return
            rec = await asyncio.to_thread(pipeline.process_file, data, path.name)
            await asyncio.to_thread(pipeline.fan_out_writes, rec)
            self._seen_sha256.add(sha256)
            job.progress.done += 1
        except Exception:
            job.progress.failed += 1


def _ext_for_mime(mime: str) -> str:
    return {
        "image/png": ".png",
        "image/webp": ".webp",
        "image/jpeg": ".jpg",
    }.get(mime.lower(), ".png")


def _list_supported_files(folder_path: str) -> list[Path]:
    root = Path(folder_path)
    if not root.is_dir():
        raise ValueError(f"folderPath is not a directory: {folder_path}")
    files = [
        p
        for p in sorted(root.rglob("*"))
        if p.is_file() and p.suffix.lower() in pipeline.SUPPORTED_EXTENSIONS
    ]
    return files


# ---------------------------------------------------------------------------
# Reconcile scheduler (issue #21) — opt-in periodic trigger
#
# Disabled by default so tests / dev never get surprise background jobs. Set
# RECONCILE_INTERVAL_SECONDS > 0 to have the service enqueue a reconcile sweep
# every N seconds. A single tick is exposed separately so tests can drive it
# directly instead of waiting on real time.
# ---------------------------------------------------------------------------
def reconcile_interval_seconds() -> int:
    """Reconcile schedule interval in seconds; 0/unset disables the scheduler."""
    try:
        return int(os.getenv("RECONCILE_INTERVAL_SECONDS", "0"))
    except ValueError:
        return 0


def run_reconcile_tick(store: "JobStore") -> Job:
    """Enqueue one reconcile job. The scheduler calls this every interval; tests
    call it directly to assert a job is enqueued without waiting on the clock."""
    return store.create_reconcile_job()


async def reconcile_scheduler(store: "JobStore") -> None:
    """Background loop: enqueue a reconcile sweep every interval (opt-in).

    No-op (returns immediately) when RECONCILE_INTERVAL_SECONDS is 0/unset, so
    importing the app or running the test suite never starts a real scheduler.
    """
    interval = reconcile_interval_seconds()
    if interval <= 0:
        return
    while True:
        await asyncio.sleep(interval)
        try:
            run_reconcile_tick(store)
        except Exception:
            # A scheduling hiccup must not kill the loop; next tick retries.
            continue
