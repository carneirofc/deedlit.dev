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
    cancel_requested: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "progress": asdict(self.progress),
            "error": self.error,
        }


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
            files = _list_supported_files(job.folder_path or "")
            job.progress.total = len(files)
            for path in files:
                if job.cancel_requested:
                    job.status = CANCELLED
                    return
                await self._process_one(job, path)
            job.status = COMPLETED
        except Exception as exc:  # folder missing, etc.
            job.status = FAILED
            job.error = str(exc)

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
