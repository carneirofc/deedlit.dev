"""add tasks ledger

Adds a ``tasks`` table: a best-effort, queryable history of the async per-image
queue tasks (ADR 0001). RabbitMQ remains the source of truth for *what work
remains*; this table answers "what has happened to image X" (per-image history)
and "show me everything in the DLQ" (by status), and feeds the queue
visualization page (#29) + the DB power page (#30).

One row per ``(sha256, type)`` — a re-enqueue (fast path / label re-index /
reconcile) UPSERTs the same row to its latest state rather than appending, so the
row reflects the current status and ``attempts`` the current retry chain. The
ingest publisher/workers write lifecycle transitions here best-effort; a failed
write never blocks the actual task.

Revision ID: 0004_tasks
Revises: 0003_source_folders
Create Date: 2026-06-14
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004_tasks"
down_revision: str | None = "0003_source_folders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS tasks (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sha256       TEXT NOT NULL,
          -- task type: 'index' (build projection) | 'label' (describe+patch).
          type         TEXT NOT NULL,
          -- lifecycle: queued / running / done / failed / dlq.
          status       TEXT NOT NULL,
          -- failed-attempt count of the current retry chain.
          attempts     INTEGER NOT NULL DEFAULT 0,
          error        TEXT,
          -- the coarse JobStore op (folder scan / reconcile / backfill) that
          -- produced this task, when known.
          parent_op_id TEXT,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (sha256, type)
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
        CREATE INDEX IF NOT EXISTS idx_tasks_sha256 ON tasks (sha256);
        CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks (updated_at DESC);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS tasks;")
