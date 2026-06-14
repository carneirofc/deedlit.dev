"""add source_folders registry

Adds a ``source_folders`` table: the persistent registry of configured ingest
folders. Before this, a folder was a one-off ``POST /ingest`` input that nothing
remembered; this table lets the system keep a list of folders, control each one
(enabled / recursive / per-folder scan interval), and record the outcome of the
most recent scan (status / job id / error / timestamp) so a background scheduler
in deedlit.ingest can re-walk each folder on its own cadence and the UI can show
its state.

Per-folder image/label counts are intentionally NOT stored here: they are
derived on read from ``images.file_path`` prefixes + the ``image_descriptions``
provider rows, so there is no ``folder_id`` FK on ``images`` to keep in sync.

Revision ID: 0003_source_folders
Revises: 0002_image_safety
Create Date: 2026-06-14
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_source_folders"
down_revision: str | None = "0002_image_safety"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS source_folders (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          path                  TEXT NOT NULL,
          label                 TEXT,
          -- Auto-scan is ON by default: a freshly added folder is immediately
          -- picked up by the background scheduler (user-confirmed default).
          enabled               BOOLEAN NOT NULL DEFAULT true,
          recursive             BOOLEAN NOT NULL DEFAULT true,
          -- Per-folder cadence: the scheduler re-walks the folder once this many
          -- seconds have elapsed since last_scan_at (15 min default).
          scan_interval_seconds INTEGER NOT NULL DEFAULT 900,
          last_scan_at          TIMESTAMPTZ,
          last_scan_status      TEXT,
          last_scan_job_id      TEXT,
          last_error            TEXT,
          created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (path)
        );
        CREATE INDEX IF NOT EXISTS idx_source_folders_enabled
            ON source_folders (enabled) WHERE enabled = true;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS source_folders;")
