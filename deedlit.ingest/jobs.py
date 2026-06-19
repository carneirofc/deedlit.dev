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

import broker
import config
import job_ledger
import ledger
import pipeline

log = logging.getLogger("deedlit.ingest.jobs")


async def _publish_stage_best_effort(
    publisher: Callable[..., Any],
    queue: str,
    sha256: str,
    parent_op_id: str | None = None,
    **pub_kwargs: Any,
) -> bool:
    """Publish one per-image stage task, swallowing broker errors (ADR 0001/0002).

    The catalog write is the durability boundary: a publish failure must NEVER
    fail the fast path. The image stays cataloged-but-unprojected and the
    reconcile / label-backfill sweeps re-enqueue it once the broker is back.
    Records ``queued`` on the ledger best-effort (off the critical path). Returns
    True on a successful publish (lets callers/tests assert the happy path).
    ``pub_kwargs`` forwards stage-specific publish args (e.g. embed.dense's ``path``).
    """
    try:
        await publisher(sha256, parent_op_id=parent_op_id, **pub_kwargs)
    except Exception as exc:  # noqa: BLE001 — best-effort by design
        log.warning(
            "%s publish failed for %s (%s); a sweep will re-enqueue", queue, sha256[:12], exc
        )
        return False
    await pipeline.maybe_await(
        ledger.record_task(sha256, queue, "queued", None, None, parent_op_id)
    )
    return True


async def _publish_embed_dense_best_effort(
    sha256: str, parent_op_id: str | None = None, path: str | None = None
) -> bool:
    # Forward ``path`` only when known so the re-publish callers (reconcile /
    # rebuild) keep the bare (sha, parent_op_id) publish shape unchanged.
    extra = {"path": path} if path else {}
    return await _publish_stage_best_effort(
        broker.publish_embed_dense_task, broker.EMBED_DENSE_QUEUE, sha256, parent_op_id,
        **extra,
    )


async def _publish_embed_sparse_best_effort(sha256: str, parent_op_id: str | None = None) -> bool:
    return await _publish_stage_best_effort(
        broker.publish_embed_sparse_task, broker.EMBED_SPARSE_QUEUE, sha256, parent_op_id
    )


async def _publish_index_search_best_effort(sha256: str, parent_op_id: str | None = None) -> bool:
    return await _publish_stage_best_effort(
        broker.publish_index_search_task, broker.INDEX_SEARCH_QUEUE, sha256, parent_op_id
    )


async def _publish_index_graph_best_effort(sha256: str, parent_op_id: str | None = None) -> bool:
    return await _publish_stage_best_effort(
        broker.publish_index_graph_task, broker.INDEX_GRAPH_QUEUE, sha256, parent_op_id
    )


async def _publish_label_best_effort(sha256: str, parent_op_id: str | None = None) -> bool:
    return await _publish_stage_best_effort(
        broker.publish_label_task, broker.LABEL_QUEUE, sha256, parent_op_id
    )


async def _publish_reproject_best_effort(sha256: str, parent_op_id: str | None = None) -> bool:
    """Re-publish the projection stages (no re-label) for one image (ADR 0002).

    Drives embed.dense + embed.sparse (which fan into index.search) + index.graph
    from catalog truth — the bulk ``rebuild-search`` / ``rebuild-graph`` reproject
    set. Returns True only when all three enqueue, so the bulk job's ``failed``
    count reflects a broker hiccup. Does NOT re-label (that is label-backfill).
    """
    results = await asyncio.gather(
        _publish_embed_dense_best_effort(sha256, parent_op_id),
        _publish_embed_sparse_best_effort(sha256, parent_op_id),
        _publish_index_graph_best_effort(sha256, parent_op_id),
    )
    return all(results)


def _now_iso() -> str:
    """UTC timestamp in ISO-8601 — the wire format the UI job rows expect."""
    return datetime.now(timezone.utc).isoformat()

# Job lifecycle states (mirrors contracts/ingest.openapi.yaml).
QUEUED = "queued"
RUNNING = "running"
COMPLETED = "completed"
FAILED = "failed"
CANCELLED = "cancelled"
# Terminal state stamped (catalog-side) on hydrate for a job left queued/running
# by a previous process — its in-memory worker is gone, so it can't settle.
INTERRUPTED = "interrupted"

# Root walked by the ``rescan-files`` maintenance job when no folderPath is
# given. Mirrors the monolith's IMAGE_LIBRARY_ROOT.
LIBRARY_ROOT = os.getenv("IMAGE_LIBRARY_ROOT", os.path.join("data", "library"))


def ingest_concurrency() -> int:
    """How many ``ingest`` tasks a folder scan publishes concurrently (ADR 0002). >= 1.

    Read live from :mod:`config` (env default + settings-panel override) on every
    scan, so it can be tuned from the UI without a restart (and pinned to 1 in
    tests that need deterministic serial ordering, via the env). Bounds the
    producer's in-flight publishes via an asyncio.Semaphore so a huge folder
    enqueues at a steady rate instead of an unbounded burst.
    """
    return config.runtime()["ingest_concurrency"]


def llm_enabled() -> bool:
    """Master switch for the vision-LLM (labelagent) enrichment stage (ADR 0001).

    Read live from :mod:`config` (env default + settings-panel override), so the
    label stage can be turned off from the UI without a restart. When off, the
    producer skips publishing ``label`` tasks and the label-backfill sweep no-ops
    — images are cataloged + projected without an AI description/safety/tags.
    """
    return config.runtime()["llm_enabled"]

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

    def to_persist(self) -> dict[str, Any]:
        """Snake_case snapshot for the catalog ``jobs`` table (job_ledger).

        Coarse, not per-file: written on the lifecycle edges (queued → terminal).
        ``*_at`` ride as ISO strings (Pydantic parses them back to datetimes)."""
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "folder_path": self.folder_path,
            "source_folder_id": self.source_folder_id,
            "total": self.progress.total,
            "done": self.progress.done,
            "skipped": self.progress.skipped,
            "failed": self.progress.failed,
            "error": self.error,
            "current_stage": self.current_stage,
            "stage_counts": self.stage_counts,
            "report": self.report,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }

    def stage_callback(self) -> Callable[[str], None]:
        """A progress hook for a job: record the current stage and bump the
        per-stage reached-count. The folder-scan producer reports the ``publish``
        stage as it enqueues each file; the worker reports the ingest/DAG stages
        on its own side. Mutates simple fields only (atomic under the GIL), so it
        is safe to call from an ``asyncio.to_thread`` worker thread."""

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


# Terminal job states — a hydrated job in any other state was left in-flight by
# a dead process, so it is loaded as ``interrupted``.
_TERMINAL_STATES = frozenset({COMPLETED, FAILED, CANCELLED, INTERRUPTED})


def _as_str(value: Any) -> str | None:
    """ISO datetime / id fields ride as strings; pass through, coercing None."""
    return str(value) if value is not None else None


def _job_from_snapshot(snap: dict[str, Any]) -> Job:
    """Rebuild an in-memory Job from a persisted catalog snapshot (hydrate)."""
    status = str(snap.get("status") or QUEUED)
    if status not in _TERMINAL_STATES:
        status = INTERRUPTED
    job = Job(id=str(snap["id"]), type=str(snap.get("type") or "ingest"), status=status)
    job.folder_path = snap.get("folder_path")
    job.source_folder_id = snap.get("source_folder_id")
    job.progress = Progress(
        total=int(snap.get("total") or 0),
        done=int(snap.get("done") or 0),
        skipped=int(snap.get("skipped") or 0),
        failed=int(snap.get("failed") or 0),
    )
    job.error = snap.get("error")
    job.current_stage = snap.get("current_stage")
    job.stage_counts = dict(snap.get("stage_counts") or {})
    job.report = snap.get("report")
    job.created_at = _as_str(snap.get("created_at")) or _now_iso()
    job.started_at = _as_str(snap.get("started_at"))
    # A job interrupted mid-run has no persisted finish; stamp one so the UI
    # shows it as ended rather than perpetually open.
    job.finished_at = _as_str(snap.get("finished_at")) or (
        _now_iso() if status == INTERRUPTED else None
    )
    return job


class JobStore:
    """Process-local registry + single-worker claim loop."""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker: asyncio.Task | None = None
        # The event loop the worker runs on, captured so a job snapshot can be
        # scheduled onto it (best-effort, fire-and-forget) even from a sync
        # endpoint thread. Set by start_worker / the async lifespan.
        self._loop: asyncio.AbstractEventLoop | None = None

    # -- durable history (best-effort write-through to catalog) ------------
    def _schedule_persist(self, job: Job) -> None:
        """Mirror ``job``'s current snapshot to the catalog ``jobs`` table.

        Fire-and-forget on the worker's loop (works from any thread via
        run_coroutine_threadsafe), so a slow/absent catalog never stalls the job.
        Called on the lifecycle edges only (queued → terminal); live per-file
        progress stays in memory and is read straight off ``GET /jobs``."""
        loop = self._loop
        if loop is None or not loop.is_running():
            return
        snapshot = job.to_persist()
        try:
            asyncio.run_coroutine_threadsafe(job_ledger.record_job(snapshot), loop)
        except Exception:  # noqa: BLE001 — scheduling is best-effort
            pass

    # -- registry ---------------------------------------------------------
    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def list(self) -> list[Job]:
        """All jobs, newest first — backs the gateway/dashboard GET /jobs list."""
        return list(reversed(self._jobs.values()))

    def hydrate(self, snapshots: list[dict[str, Any]]) -> int:
        """Seed the registry from persisted catalog snapshots on startup.

        Loads history so ``GET /jobs`` (and the dashboard) shows past jobs right
        after a restart. Hydrated jobs are NOT re-queued — their async work is
        gone; any non-terminal one is flipped to ``interrupted`` (the catalog has
        already done the same server-side). ``snapshots`` arrive newest-first
        (catalog order); insert oldest-first so ``list`` still yields newest-first.
        Existing ids win, so a live job created before hydrate isn't clobbered.
        """
        loaded = 0
        for snap in reversed(snapshots):
            jid = snap.get("id")
            if not jid or jid in self._jobs:
                continue
            self._jobs[jid] = _job_from_snapshot(snap)
            loaded += 1
        return loaded

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
        self._schedule_persist(job)  # record the queued snapshot for history
        return job

    def _enqueue(self, job: Job) -> Job:
        self._jobs[job.id] = job
        self._queue.put_nowait(job.id)
        self._schedule_persist(job)  # record the queued snapshot for history
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
            self._schedule_persist(job)  # terminal: persist the cancel
        return job

    # -- worker -----------------------------------------------------------
    def start_worker(self) -> None:
        # Capture the running loop (lifespan/async context) so _schedule_persist
        # can target it from any thread. A no-op from a sync endpoint thread
        # (no running loop) — the lifespan has already set it by then.
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            pass
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
            # Persist the terminal snapshot (status + final counts + finished_at)
            # so the job survives a restart in the catalog history.
            self._schedule_persist(job)
        log.info(
            "job %s (%s) -> %s (total=%d done=%d skipped=%d failed=%d)",
            job.id, job.type, job.status,
            job.progress.total, job.progress.done, job.progress.skipped, job.progress.failed,
        )

    async def _run_folder(self, job: Job) -> None:
        """Walk the folder and PUBLISH one ``ingest`` task per NEW file (ADR 0002).

        The producer does no processing — it only enqueues. The ingest-worker pool
        reads the bytes, catalogs each file, and fans out the per-stage DAG, all in
        parallel across processes. Up to ``INGEST_CONCURRENCY`` publishes are kept
        in flight via a semaphore so a huge folder enqueues steadily; cancellation
        is honoured between launches (already-launched publishes finish, then the
        job settles cancelled). ``progress.done`` counts files ENQUEUED.

        INCREMENTAL: files already cataloged (by on-disk path) are SKIPPED so a
        scheduled re-walk / manual re-ingest of an unchanged library doesn't
        re-enqueue the whole projection DAG (which would re-embed + re-label every
        image every scan, never draining the queues). A file edited in place keeps
        its path — re-project it explicitly via reindex.
        """
        files = _list_supported_files(job.folder_path or "")
        job.progress.total = len(files)
        # Dedup against catalog truth (one paged read). A lookup failure degrades
        # to enqueuing everything rather than skipping new files.
        try:
            cataloged = await asyncio.to_thread(
                pipeline.list_catalog_filepaths_under, job.folder_path or ""
            )
        except Exception as exc:  # noqa: BLE001 — catalog down: don't drop new files
            log.warning(
                "folder scan %s: catalog dedup lookup failed (%s); enqueuing all",
                job.id, exc,
            )
            cataloged = set()
        new_files: list[Path] = []
        for path in files:
            if str(path).replace("\\", "/") in cataloged:
                job.progress.skipped += 1
            else:
                new_files.append(path)
        files = new_files
        if files:
            log.info(
                "folder scan %s: %d new, %d already cataloged (skipped)",
                job.id, len(files), job.progress.skipped,
            )
        sem = asyncio.Semaphore(ingest_concurrency())
        tasks: list[asyncio.Task] = []

        async def _run_one(path: Path) -> None:
            try:
                await self._process_one(job, path)
            finally:
                sem.release()

        for path in files:
            if job.cancel_requested:
                break
            await sem.acquire()  # block until a concurrency slot frees up
            if job.cancel_requested:
                sem.release()
                break
            tasks.append(asyncio.create_task(_run_one(path)))
        await asyncio.gather(*tasks)
        job.status = CANCELLED if job.cancel_requested else COMPLETED

    async def _run_reindex_one(self, job: Job) -> None:
        """Re-project a single already-cataloged image via the queue (ADR 0002).

        Publishes the projection stages from catalog truth — embed.dense +
        embed.sparse (which fan into index.search) + index.graph — the same set
        ``POST /tasks/index`` enqueues. No inline pipeline: the GPU/search/graph
        work runs in the parallel worker pool. Does NOT re-label (that is the
        separate ``label`` task / label-backfill).
        """
        job.progress.total = 1
        if job.cancel_requested:
            job.status = CANCELLED
            return
        sha256 = job.sha256 or ""
        if await _publish_reproject_best_effort(sha256, parent_op_id=job.id):
            job.progress.done += 1
        else:
            job.progress.failed += 1
        job.status = COMPLETED

    async def _run_rebuild(self, job: Job) -> None:
        """Rebuild a projection (ADR 0002 — coarse op as task producer).

        ``rebuild-search`` / ``rebuild-graph`` are BULK PRODUCERS: they re-publish
        the projection stages (embed.dense + embed.sparse -> index.search, plus
        index.graph) for every cataloged image from catalog truth, so the two
        types are equivalent (both reproject all stores). ``rebuild-thumbnails``
        stays a catalog-owned rebuild (thumbnails are catalog blobs, not a queue
        projection).
        """
        if job.type in (REBUILD_SEARCH, REBUILD_GRAPH):
            await self._run_bulk_index(job)
            return
        # rebuild-thumbnails: a single opaque unit of work owned by catalog.
        job.progress.total = 1
        if job.cancel_requested:
            job.status = CANCELLED
            return
        rebuild = getattr(pipeline, job.rebuild_func or "")
        await asyncio.to_thread(rebuild)
        job.progress.done += 1
        job.status = COMPLETED

    async def _run_bulk_index(self, job: Job) -> None:
        """Re-publish the projection stages for every cataloged image (ADR 0002).

        Progress counts images enqueued; cancellation is honoured cooperatively.
        Best-effort publish: a broker hiccup increments ``failed`` but does not
        abort the sweep. Images are reprojected with bounded concurrency so a large
        catalog fans out fast instead of one publish at a time.
        """
        shas = await asyncio.to_thread(pipeline.list_catalog_sha256)
        job.progress.total = len(shas)
        sem = asyncio.Semaphore(ingest_concurrency())

        async def _one(sha: str) -> None:
            async with sem:
                if job.cancel_requested:
                    return
                if await _publish_reproject_best_effort(sha, parent_op_id=job.id):
                    job.progress.done += 1
                else:
                    job.progress.failed += 1

        await asyncio.gather(*(_one(sha) for sha in shas))
        job.status = CANCELLED if job.cancel_requested else COMPLETED

    async def _run_reconcile(self, job: Job) -> None:
        """Reconcile sweep: catalog truth vs the per-stage DAG outputs (#21,
        ADR 0002 — coarse op as task producer).

        For each cataloged image, probe the four stage outputs that hang off
        catalog truth — the persisted dense vector (``embedding`` blob), the
        sparse vector (``sparse`` blob), the search point, and the graph node —
        and re-publish exactly the stage(s) that are missing:

          - no dense blob   -> embed.dense   (which fans into index.search)
          - no sparse blob  -> embed.sparse  (which fans into index.search)
          - both vectors present but no search point -> index.search directly
          - no graph node   -> index.graph

        This is the safety net for the best-effort publish model: anything dropped
        during a broker outage shows up as drift here and is re-enqueued at the
        right stage. Progress counts catalog images probed; cancellation is
        checked between probes and between publishes.
        """
        STAGES = (
            broker.EMBED_DENSE_QUEUE,
            broker.EMBED_SPARSE_QUEUE,
            broker.INDEX_SEARCH_QUEUE,
            broker.INDEX_GRAPH_QUEUE,
        )
        catalog = await asyncio.to_thread(pipeline.list_catalog_sha256)
        job.progress.total = len(catalog)

        images: dict[str, dict[str, Any]] = {}
        drift: dict[str, list[str]] = {s: [] for s in STAGES}

        # -- per-stage coverage probe (per catalog image), CONCURRENT --
        # The four probes for one image are independent reads, and images are
        # independent of each other, so they all run concurrently (bounded by the
        # producer concurrency knob). Results are collected into a dict and the
        # drift lists are then assembled in CATALOG order so the report stays
        # deterministic regardless of probe completion order.
        sem = asyncio.Semaphore(ingest_concurrency())
        probed: dict[str, dict[str, bool]] = {}

        async def _probe(sha: str) -> None:
            async with sem:
                if job.cancel_requested:
                    return
                dense, sparse, in_search, in_graph = await asyncio.gather(
                    pipeline.maybe_await(pipeline.load_dense_blob(sha)),
                    pipeline.maybe_await(pipeline.load_sparse_blob(sha)),
                    pipeline.maybe_await(pipeline.search_has(sha)),
                    pipeline.maybe_await(pipeline.graph_has(sha)),
                )
                probed[sha] = {
                    "dense": dense is not None, "sparse": sparse is not None,
                    "in_search": bool(in_search), "in_graph": bool(in_graph),
                }
                job.progress.done += 1

        await asyncio.gather(*(_probe(sha) for sha in catalog))

        if job.cancel_requested:
            job.status = CANCELLED
            return

        for sha in catalog:
            r = probed.get(sha)
            if r is None:
                continue
            need: list[str] = []
            if not r["dense"]:
                need.append(broker.EMBED_DENSE_QUEUE)
            if not r["sparse"]:
                need.append(broker.EMBED_SPARSE_QUEUE)
            # Only re-publish index.search directly when both vectors already exist
            # (otherwise it would no-op); a missing vector's embed stage fans in.
            if r["dense"] and r["sparse"] and not r["in_search"]:
                need.append(broker.INDEX_SEARCH_QUEUE)
            if not r["in_graph"]:
                need.append(broker.INDEX_GRAPH_QUEUE)

            images[sha] = {**r, "enqueued": []}
            for stage in need:
                drift[stage].append(sha)

        # -- re-enqueue exactly the drifted stage(s) per image --
        publishers = {
            broker.EMBED_DENSE_QUEUE: _publish_embed_dense_best_effort,
            broker.EMBED_SPARSE_QUEUE: _publish_embed_sparse_best_effort,
            broker.INDEX_SEARCH_QUEUE: _publish_index_search_best_effort,
            broker.INDEX_GRAPH_QUEUE: _publish_index_graph_best_effort,
        }
        enqueued: dict[str, list[str]] = {s: [] for s in STAGES}
        for stage in STAGES:
            for sha in drift[stage]:
                if job.cancel_requested:
                    job.status = CANCELLED
                    return
                if await publishers[stage](sha, parent_op_id=job.id):
                    images[sha]["enqueued"].append(stage)
                    enqueued[stage].append(sha)

        job.report = {
            "catalog_count": len(catalog),
            "drift": drift,
            "enqueued": enqueued,
            "repair_strategy": "enqueue-per-stage",
            "images": images,
        }
        job.status = COMPLETED

    async def _run_label_backfill(self, job: Job) -> None:
        """Publish a label task for every cataloged image missing an AI
        description (ADR 0001 — coarse op as task producer).

        Work set = catalog ``/images/unlabeled``. Each image gets a label task
        (describe -> patch catalog -> re-index). Also the safety net for label
        publishes missed during a broker outage. Cancellation is checked between
        publishes; a publish hiccup increments ``failed`` rather than aborting.

        No-op when the vision-LLM master switch is off (:func:`llm_enabled`) — the
        sweep exists to ADD AI descriptions, so it has nothing to do while LLM
        enrichment is disabled; it completes immediately with zero work.
        """
        if not llm_enabled():
            job.progress.total = 0
            job.status = COMPLETED
            log.info("label-backfill %s skipped: LLM processing is disabled", job.id)
            return
        shas = await asyncio.to_thread(pipeline.list_unlabeled_sha256)
        job.progress.total = len(shas)
        for sha in shas:
            if job.cancel_requested:
                job.status = CANCELLED
                return
            if await _publish_label_best_effort(sha, parent_op_id=job.id):
                job.progress.done += 1
            else:
                job.progress.failed += 1
        job.status = COMPLETED

    async def _process_one(self, job: Job, path: Path) -> None:
        """Enqueue ONE ``ingest`` task for a file — no inline processing (ADR 0002).

        The producer only publishes; the ingest-worker pool reads the bytes, writes
        the catalog record + thumbnail, and fans out the per-stage DAG. RabbitMQ is
        the durability boundary: a publish failure marks the file failed (no inline
        fallback) — the next scan re-enqueues it once the broker is back.
        """
        started = time.perf_counter()
        on_stage = job.stage_callback()
        on_stage("publish")
        try:
            await broker.publish_ingest_task(
                str(path), source_folder_id=job.source_folder_id, parent_op_id=job.id
            )
        except Exception as exc:
            job.progress.failed += 1
            log.exception(
                "FAILED to enqueue %s after %.0f ms: %s",
                path.name, (time.perf_counter() - started) * 1000, exc,
            )
            return
        job.progress.done += 1
        log.info(
            "enqueued(ingest) %s in %.0f ms (%d/%d)", path.name,
            (time.perf_counter() - started) * 1000, job.progress.done, job.progress.total,
        )


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


def folder_scan_max_ingest_backlog() -> int:
    """Backpressure ceiling: skip a folder-scan tick while ``ingest`` already holds
    at least this many ready tasks (0/unset disables the gate).

    The folder scan's INCREMENTAL skip only dedups against the CATALOG (already
    ingested files). A file that is queued-but-not-yet-cataloged — because the
    worker is down, or simply slower than the tick — is NOT skipped, so each tick
    re-enqueues it and ``ingest`` grows without bound (observed: tens of thousands
    of duplicate ingest tasks, zero consumers). Gating the producer on live queue
    depth caps that runaway: when the backlog is already deep, stop publishing more
    and let the worker catch up first.
    """
    try:
        return int(os.getenv("FOLDER_SCAN_MAX_INGEST_BACKLOG", "5000"))
    except ValueError:
        return 5000


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

    Backpressure: each tick first checks the live ``ingest`` queue depth and skips
    publishing a fresh wave while it is already at/over
    ``FOLDER_SCAN_MAX_INGEST_BACKLOG`` — without this gate the scheduler re-enqueues
    not-yet-cataloged files every tick and the queue runs away unbounded.
    """
    tick = folder_scan_tick_seconds()
    if tick <= 0:
        return
    ceiling = folder_scan_max_ingest_backlog()
    while True:
        await asyncio.sleep(tick)
        try:
            if ceiling > 0:
                try:
                    depth = await broker.queue_depth(broker.INGEST_QUEUE)
                except Exception as exc:  # noqa: BLE001 — broker down / queue absent
                    log.debug("folder scan backpressure probe failed (%s); not gating", exc)
                    depth = 0
                if depth >= ceiling:
                    log.warning(
                        "folder scan tick skipped: ingest backlog %d >= %d (backpressure); "
                        "let the worker drain before enqueuing more",
                        depth, ceiling,
                    )
                    continue
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
