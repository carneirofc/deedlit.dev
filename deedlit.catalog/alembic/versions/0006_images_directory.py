"""add images.directory (source-directory grouping key)

Adds a derived ``directory`` column to ``images`` = the parent directory of
``file_path`` (everything up to the last path separator, separators normalized to
forward slashes). The library "split / group by source directory" view needs to
group and count images by their on-disk folder; the only location data today is
the free-text ``file_path``, and the browse ``path`` filter is an UNANCHORED
substring scan (``strpos`` in ``_image_filters``) that cannot GROUP BY a directory
and over-matches (``/a/b`` also matches ``/x/a/b/c``).

``directory`` gives an indexed, anchored grouping key. It is derived from
``file_path`` and — like ``file_path`` / ``filename`` — written INSERT-only by the
catalog (absent from the upsert ON CONFLICT update), so a reindex that carries no
path never clobbers it. This migration backfills it for existing rows.

Revision ID: 0006_images_directory
Revises: 0005_jobs_settings
Create Date: 2026-06-20
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006_images_directory"
down_revision: str | None = "0005_jobs_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        r"""
        ALTER TABLE images ADD COLUMN IF NOT EXISTS directory TEXT;

        -- Backfill: parent directory of file_path. Normalize the OS separator
        -- (ingest may run on Windows, catalog on Linux — same convention as
        -- _folder_counts / _image_filters), then strip the trailing
        -- '/<filename>'. A path with no separator yields '' (root / unknown).
        UPDATE images
           SET directory = regexp_replace(replace(file_path, '\', '/'), '/[^/]*$', '')
         WHERE directory IS NULL;

        CREATE INDEX IF NOT EXISTS idx_images_directory ON images (directory);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS idx_images_directory;
        ALTER TABLE images DROP COLUMN IF EXISTS directory;
        """
    )
