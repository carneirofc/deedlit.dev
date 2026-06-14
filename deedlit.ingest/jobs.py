"""In-memory job model + async claim/worker loop.

deedlit.ingest is stateless and holds NO DB driver, so the job registry lives in
process memory. A single async worker loop claims queued jobs and runs them to
completion, updating progress counters as it goes. Cancellation is cooperative:
the worker checks a per-job flag between files.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pipeline

log = logging.getLogger("deedlit.ingest.jobs")


def _now_iso() -> str:
    """UTC timestamp in ISO-8601 — the wire format the UI job rows expect."""
    return datetime.now(timezone.utc).isoformat()

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

# Label backfill (configured-folders feature): find cataloged images with no
# labelagent description and re-run the pipeline so they get one (+ safety +
# AI tags), then re-project. The work set comes from catalog
# /images/unlabeled; each image is repaired via the existing reindex path.
LABEL_BACKFILL = "label-backfill"

# When the number of drifted images for a projection is at or below this, repair
# them one-by-one (cheaper, targeted) instead of a full collection rebuild.
RECONCILE_PER_IMAGE_MAX = int(os.getenv("RECONCILE_PER_IMAGE_MAX", "10"))

# rebuild-* -> the owning service's rebuild-from-catalog entrypoint (#17).
# Each value is the name of the pipeline function that drives the owning
# service's rebuild DIRECTLY (no longer the TS app):
#   rebuild-search     -> search POST /rebuild
#   rebuild-graph      -> graph  POST /rebuild
#   rebuild-thumbnails -> catalog rebuild (catalog owns thumbnail blobs)
REBUILD_FUNCS = {
    REBUILD_SEARCH: "rebuild_search",
    REBUILD_GRAPH: "rebuild_graph",
    REBUILD_THUMBNAILS: "rebuild_thumbnails",
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
    rebuild_func: str | None = None
    per_image_max: int | None = None
    cancel_requested: bool = False
    # When this job is a scheduled scan of a configured folder, its registry id.
    # The worker writes the scan outcome back to catalog under this id so the UI
    # shows each folder's last-scan status/time. None for ad-hoc ingests.
    source_folder_id: str | None = None
    # Reconcile output: per-image projection status + repair summary (#21).
    report: dict[str, Any] | None = None
    # Live observability: which pipeline stage the worker is in right now
    # (hash/metadata/label/vision:dense/vision:sparse/catalog/search/graph) and a
    # per-stage count of files that have REACHED that stage — drives the UI's
    # "which microservice is active doing what" board + the activity dock.
    current_stage: str | None = None
    stage_counts: dict[str, int] = field(default_factory=dict)
    # Lifecycle timestamps (ISO-8601 UTC). The UI shows created/started/finished
    # and derives duration/throughput; without these they render "—".
    created_at: str = field(default_factory=_now_iso)
    started_at: str | None = None
    finished_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "progress": asdict(self.progress),
            "error": self.error,
            # Flattened aliases for the UI dashboard + activity dock, which
            # normalize on snake_case `*_files` / `folder_path` / `error_message`
            # (see comfyhelper lib/store/activity-jobs.ts + api/library/jobs).
            # Without these the dock shows 0/0 progress and never settles.
            "total_files": self.progress.total,
            "processed_files": self.progress.done,
            "skipped_files": self.progress.skipped,
            "failed_files": self.progress.failed,
            "folder_path": self.folder_path,
            "error_message": self.error,
            # Live stage + lifecycle timestamps (snake_case; the UI normalizes
            # both camelCase and snake_case — see lib/store/activity-jobs.ts).
            "current_stage": self.current_stage,
            "stage_counts": self.stage_counts,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }
        if self.report is not None:
            out["report"] = self.report
        return out

    def stage_callback(self) -> Callable[[str], None]:
        """A progress hook for the pipeline: record the current stage and bump
        the per-stage reached-count. Passed into ``pipeline.process_file`` /
        ``pipeline.fan_out_writes`` so a running ingest reports which service is
        active right now. Mutates simple fields only (atomic under the GIL), so
        it is safe to call from the ``asyncio.to_thread`` worker thread."""

        # Per-file timing state: log how long the PREVIOUS stage took as soon as
        # the next one begins, so a slow service (e.g. the labelagent LLM at the
        # `label` stage, or `vision:dense` waiting on the GPU) is obvious in the
        # log. The closure is per-file (one callback is created per _process_one).
        state: dict[str, Any] = {"prev": None, "since": None}

        def cb(stage: str) -> None:
            now = time.perf_counter()
            if state["prev"] is not None:
                log.info(
                    "job %s | %-13s %7.0f ms", self.id[:8], state["prev"],
                    (now - state["since"]) * 1000,
                )
            state["prev"] = stage
            state["since"] = now
            self.current_stage = stage
            self.stage_counts[stage] = self.stage_counts.get(stage, 0) + 1

        return cb


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

    def list(self) -> list[Job]:
        """All jobs, newest first — backs the gateway/dashboard GET /jobs list."""
        return list(reversed(self._jobs.values()))

    def create_ingest_job(
        self, folder_path: str, *, source_folder_id: str | None = None
    ) -> Job:
        job = Job(
            id=str(uuid.uuid4()),
            type="ingest",
            folder_path=folder_path,
            source_folder_id=source_folder_id,
        )
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
          - rebuild-search/graph/thumbnails: drive the corresponding rebuild
            DIRECTLY against the owning service (#17; see REBUILD_FUNCS).
        """
        job = Job(id=str(uuid.uuid4()), type=mtype)
        if mtype == REINDEX_ONE_IMAGE:
            job.sha256 = sha256
        elif mtype == RESCAN_FILES:
            job.folder_path = folder_path or LIBRARY_ROOT
        elif mtype in REBUILD_FUNCS:
            job.rebuild_func = REBUILD_FUNCS[mtype]
        elif mtype == RECONCILE:
            return self.create_reconcile_job()
        # LABEL_BACKFILL needs no extra inputs — its work set is the catalog's
        # unlabeled set, fetched at run time.
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
        # A queued-but-not-started job can be cancelled immediately. It never
        # enters _run_job (the worker skips CANCELLED), so stamp finished here.
        if job.status == QUEUED:
            job.status = CANCELLED
            job.finished_at = _now_iso()
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
            job.finished_at = _now_iso()
            return
        job.status = RUNNING
        job.started_at = _now_iso()
        log.info("job %s (%s) started folder=%s sha256=%s", job.id, job.type, job.folder_path, job.sha256)
        try:
            if job.type == REINDEX_ONE_IMAGE:
                await self._run_reindex_one(job)
            elif job.type == RECONCILE:
                await self._run_reconcile(job)
            elif job.type == LABEL_BACKFILL:
                await self._run_label_backfill(job)
            elif job.type in REBUILD_FUNCS:
                await self._run_rebuild(job)
            else:
                # "ingest" and "rescan-files" both walk a folder and run the
                # per-file pipeline — rescan-files reuses the #9 folder pipeline.
                await self._run_folder(job)
        except Exception as exc:  # folder missing, image not found, etc.
            if job.status not in (CANCELLED,):
                job.status = FAILED
                job.error = str(exc)
            log.exception("job %s (%s) FAILED: %s", job.id, job.type, exc)
        finally:
            # Settled on every path (completed / failed / cancelled mid-run).
            job.finished_at = _now_iso()
            # If this was a scheduled scan of a configured folder, write its
            # outcome back to the registry so the UI shows last-scan status/time.
            # Best-effort: a registry write must never fail the scan it describes.
            if job.source_folder_id:
                await asyncio.to_thread(
                    pipeline.record_folder_scan,
                    job.source_folder_id,
                    status=job.status,
                    job_id=job.id,
                    # "" (not None) so a successful re-scan CLEARS a prior error;
                    # record_folder_scan only writes non-None fields.
                    error=job.error or "",
                    touch_last_scan_at=True,
                )
        log.info(
            "job %s (%s) -> %s (total=%d done=%d skipped=%d failed=%d)",
            job.id, job.type, job.status,
            job.progress.total, job.progress.done, job.progress.skipped, job.progress.failed,
        )

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
        # Backfill the source path from catalog so the re-projected search
        # payload keeps the image's file identity (see pipeline.reindex_image).
        source_path = await asyncio.to_thread(pipeline.fetch_image_filepath, sha256)
        if job.cancel_requested:
            job.status = CANCELLED
            return
        on_stage = job.stage_callback()
        rec = await asyncio.to_thread(
            pipeline.process_file, data, filename, source_path, on_stage
        )
        await asyncio.to_thread(pipeline.fan_out_writes, rec, on_stage)
        self._seen_sha256.add(rec.sha256)
        job.progress.done += 1
        job.status = COMPLETED

    async def _run_rebuild(self, job: Job) -> None:
        """Drive a store rebuild DIRECTLY against the owning service (#17).

        The rebuild itself is a single opaque unit of work owned by the store
        (search/graph/catalog); the ingest job wraps it so it gets the standard
        lifecycle (queued/running/completed + cancellable while queued). The
        target function is resolved from REBUILD_FUNCS (search/graph POST
        /rebuild, catalog thumbnail rebuild).
        """
        job.progress.total = 1
        if job.cancel_requested:
            job.status = CANCELLED
            return
        rebuild = getattr(pipeline, job.rebuild_func or "")
        await asyncio.to_thread(rebuild)
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

    async def _run_label_backfill(self, job: Job) -> None:
        """Re-run the pipeline for every cataloged image missing an AI label.

        Work set = catalog ``/images/unlabeled`` (no labelagent description). Each
        image is repaired via the existing ``reindex_image`` path, which re-runs
        the full pipeline (incl. the labelagent when ``LABELAGENT_URL`` is set) and
        re-projects search/graph — so the description, safety and AI tags all land
        and the search/sparse side reflects them. Cancellation is checked between
        images; a per-image failure is counted and skipped rather than aborting.
        """
        shas = await asyncio.to_thread(pipeline.list_unlabeled_sha256)
        job.progress.total = len(shas)
        for sha in shas:
            if job.cancel_requested:
                job.status = CANCELLED
                return
            try:
                await asyncio.to_thread(pipeline.reindex_image, sha)
                self._seen_sha256.add(sha)
                job.progress.done += 1
            except Exception as exc:  # one image failing must not abort the sweep
                job.progress.failed += 1
                log.warning("label backfill failed for %s: %s", sha[:12], exc)
        job.status = COMPLETED

    async def _process_one(self, job: Job, path: Path) -> None:
        started = time.perf_counter()
        try:
            data = await asyncio.to_thread(path.read_bytes)
            sha256 = pipeline.compute_sha256(data)
            if sha256 in self._seen_sha256:
                job.progress.skipped += 1
                log.debug("skip (already seen) %s -> %s", path.name, sha256[:12])
                return
            # Mark each file's start so the log shows processing has BEGUN (and on
            # which file) before the per-stage timings stream out below it.
            log.info("processing %s -> %s", path.name, sha256[:12])
            on_stage = job.stage_callback()
            rec = await asyncio.to_thread(
                pipeline.process_file, data, path.name, str(path), on_stage
            )
            await asyncio.to_thread(pipeline.fan_out_writes, rec, on_stage)
            self._seen_sha256.add(sha256)
            job.progress.done += 1
            log.info(
                "ingested %s -> %s in %.0f ms (%d/%d)", path.name, sha256[:12],
                (time.perf_counter() - started) * 1000, job.progress.done, job.progress.total,
            )
        except Exception as exc:
            job.progress.failed += 1
            # Previously swallowed silently — the #1 reason ingest "fails" with no
            # trace. Log the offending file, the STAGE it died at (so a slow/failing
            # downstream is obvious), and the full traceback.
            log.exception(
                "FAILED to ingest %s at stage=%s after %.0f ms: %s",
                path.name, job.current_stage, (time.perf_counter() - started) * 1000, exc,
            )


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


# ---------------------------------------------------------------------------
# Folder scan scheduler (configured-folders feature) — per-folder cadence
#
# Each registered folder carries its own scan_interval_seconds + last_scan_at.
# Every FOLDER_SCAN_TICK_SECONDS the scheduler asks catalog for the folder list
# and enqueues an ingest job for each enabled folder that is past due, stamping
# last_scan_at forward so a folder isn't picked again until a full interval
# elapses. Disabled (and so silent in tests) when the tick is 0/unset.
# ---------------------------------------------------------------------------
def folder_scan_tick_seconds() -> int:
    """How often (seconds) to evaluate folders for due scans; 0/unset disables."""
    try:
        return int(os.getenv("FOLDER_SCAN_TICK_SECONDS", "0"))
    except ValueError:
        return 0


def _folder_due(folder: dict[str, Any], now: datetime) -> bool:
    """True when an enabled folder is past its per-folder scan interval (or has
    never been scanned)."""
    if not folder.get("enabled"):
        return False
    last = folder.get("last_scan_at")
    if not last:
        return True
    try:
        last_dt = datetime.fromisoformat(str(last))
    except ValueError:
        return True
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)
    interval = int(folder.get("scan_interval_seconds") or 0)
    return (now - last_dt).total_seconds() >= interval


def run_folder_scan_tick(store: "JobStore") -> list[Job]:
    """Enqueue an ingest scan for every enabled, past-due folder.

    Returns the jobs enqueued (tests assert on this without waiting on the
    clock). Folders already being scanned in this process are skipped so a scan
    that outruns its interval can't stack up.
    """
    try:
        folders = pipeline.list_source_folders()
    except Exception as exc:  # catalog down / transport — try again next tick
        log.warning("folder scan tick: could not list folders: %s", exc)
        return []
    now = datetime.now(timezone.utc)
    active = {
        j.source_folder_id
        for j in store.list()
        if j.source_folder_id and j.status in (QUEUED, RUNNING)
    }
    enqueued: list[Job] = []
    for folder in folders:
        fid = folder.get("id")
        path = folder.get("path")
        if not fid or not path or fid in active:
            continue
        if not _folder_due(folder, now):
            continue
        job = store.create_ingest_job(path, source_folder_id=fid)
        # Stamp last_scan_at NOW so the next tick won't re-enqueue this folder
        # until a full interval after the scan was kicked off (the worker stamps
        # it again with the final status on completion).
        pipeline.record_folder_scan(
            fid, status=QUEUED, job_id=job.id, touch_last_scan_at=True
        )
        enqueued.append(job)
    return enqueued


async def folder_scan_scheduler(store: "JobStore") -> None:
    """Background loop: evaluate folders for due scans every tick (opt-in).

    No-op when FOLDER_SCAN_TICK_SECONDS is 0/unset, so importing the app or
    running tests never starts a real scheduler.
    """
    tick = folder_scan_tick_seconds()
    if tick <= 0:
        return
    while True:
        await asyncio.sleep(tick)
        try:
            run_folder_scan_tick(store)
        except Exception:
            continue


# ---------------------------------------------------------------------------
# Label backfill scheduler (configured-folders feature)
#
# Periodically enqueue a single label-backfill job (relabel every cataloged
# image missing an AI description). Opt-in via LABEL_BACKFILL_INTERVAL_SECONDS;
# skips a tick when one is already queued/running so backfills never stack.
# ---------------------------------------------------------------------------
def label_backfill_interval_seconds() -> int:
    """Label-backfill schedule interval in seconds; 0/unset disables it."""
    try:
        return int(os.getenv("LABEL_BACKFILL_INTERVAL_SECONDS", "0"))
    except ValueError:
        return 0


def run_label_backfill_tick(store: "JobStore") -> Job:
    """Enqueue one label-backfill job (tests call this directly)."""
    return store.create_maintenance_job(LABEL_BACKFILL)


async def label_backfill_scheduler(store: "JobStore") -> None:
    """Background loop: enqueue a label-backfill sweep every interval (opt-in)."""
    interval = label_backfill_interval_seconds()
    if interval <= 0:
        return
    while True:
        await asyncio.sleep(interval)
        try:
            if any(
                j.type == LABEL_BACKFILL and j.status in (QUEUED, RUNNING)
                for j in store.list()
            ):
                continue
            run_label_backfill_tick(store)
        except Exception:
            continue
