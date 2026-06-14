"""add images.safety content-safety class

Adds a nullable ``safety`` column to ``images`` for the AI content-safety
classification (``sfw`` / ``nsfw`` / ``explicit``) emitted by deedlit.labelagent
at ingest and used by the app's content-safety filter. Nullable on purpose:
images ingested without the labelagent (or pre-dating it) have NULL safety and
are treated as "unclassified" by the filter.

Revision ID: 0002_image_safety
Revises: 0001_catalog_baseline
Create Date: 2026-06-14
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_image_safety"
down_revision: str | None = "0001_catalog_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE images ADD COLUMN IF NOT EXISTS safety TEXT
            CHECK (safety IS NULL OR safety IN ('sfw', 'nsfw', 'explicit'));
        CREATE INDEX IF NOT EXISTS idx_images_safety ON images (safety);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS idx_images_safety;
        ALTER TABLE images DROP COLUMN IF EXISTS safety;
        """
    )
