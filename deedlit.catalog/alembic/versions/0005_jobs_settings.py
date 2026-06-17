"""add jobs registry + settings KV

Adds two tables:

``jobs`` — a durable projection of deedlit.ingest's in-memory JobStore (the
coarse operations: folder ingest / reconcile / rebuild / label-backfill). The
ingest service is stateless (no DB driver), so it write-throughs each job's
lifecycle here over HTTP, the same best-effort way it writes the per-image
``tasks`` ledger (0004). This lets the job history survive an ingest restart and
backs the admin dashboard's jobs panel. ``id`` is the uuid ingest generates and
already stamps on each task row as ``parent_op_id``, so ``tasks.parent_op_id``
joins back to ``jobs.id``.

``settings`` — a generic key/value store (one JSON blob per key) holding the
ingest producer config overrides (``ingest_config``: folder-scan concurrency +
route-via-queue) so a value set from the UI survives an ingest restart instead
of reverting to the env default.

Revision ID: 0005_jobs_settings
Revises: 0004_tasks
Create Date: 2026-06-17
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005_jobs_settings"
down_revision: str | None = "0004_tasks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS jobs (
          -- The uuid ingest generates for the JobStore entry (NOT catalog-
          -- generated), so tasks.parent_op_id joins back to it.
          id               TEXT PRIMARY KEY,
          -- ingest / rescan-files / reconcile / rebuild-* / label-backfill.
          type             TEXT NOT NULL,
          -- lifecycle: queued / running / completed / failed / cancelled /
          -- interrupted (interrupted = left in-flight by a previous process).
          status           TEXT NOT NULL,
          folder_path      TEXT,
          -- registry id when this job is a scheduled scan of a configured folder.
          source_folder_id TEXT,
          total            INTEGER NOT NULL DEFAULT 0,
          done             INTEGER NOT NULL DEFAULT 0,
          skipped          INTEGER NOT NULL DEFAULT 0,
          failed           INTEGER NOT NULL DEFAULT 0,
          error            TEXT,
          current_stage    TEXT,
          stage_counts     JSONB NOT NULL DEFAULT '{}'::jsonb,
          report           JSONB,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          started_at       TIMESTAMPTZ,
          finished_at      TIMESTAMPTZ,
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        -- list_jobs orders by updated_at (the restart hydrate + dashboard read);
        -- no hot path filters by status (the interrupt-stale sweep runs once at
        -- startup over a small table), so updated_at is the only index needed.
        -- NB: a generic name like idx_jobs_status would collide with a legacy
        -- ingestion_jobs index (pg index names are schema-global).
        CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs (updated_at DESC);

        CREATE TABLE IF NOT EXISTS settings (
          key        TEXT PRIMARY KEY,
          value      JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS jobs;")
    op.execute("DROP TABLE IF EXISTS settings;")
