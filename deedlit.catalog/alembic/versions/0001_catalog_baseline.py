"""catalog baseline schema

Ports the canonical Image Library schema from
``deedlit.dev.comfyhelper/lib/library/db/schema.sql`` (PostgreSQL = source of
truth) and adds the catalog-service tables: ``notes`` (+ ordered image refs),
``collections`` (+ ordered membership) and ``image_references`` (per-image
asset references keyed by the cross-service sha256 id).

This migration is owned by the deedlit.catalog service and is the single
baseline later services build against.

Revision ID: 0001_catalog_baseline
Revises:
Create Date: 2026-06-13
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_catalog_baseline"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ---------------------------------------------------------------------------
# Ported verbatim (idempotent form) from comfyhelper schema.sql.
# ---------------------------------------------------------------------------
PORTED_SCHEMA = r"""
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --- core images ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS images (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path        TEXT NOT NULL,
  thumbnail_path   TEXT,
  filename         TEXT NOT NULL,
  extension        TEXT,
  sha256_hash      TEXT NOT NULL,
  perceptual_hash  TEXT,
  width            INTEGER,
  height           INTEGER,
  file_size_bytes  BIGINT,
  created_at       TIMESTAMPTZ,
  imported_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at      TIMESTAMPTZ,
  source_tool      TEXT,
  prompt           TEXT,
  negative_prompt  TEXT,
  workflow_json    JSONB,
  metadata_json    JSONB,
  rating           INTEGER,
  favorite         BOOLEAN NOT NULL DEFAULT false,
  deleted          BOOLEAN NOT NULL DEFAULT false,
  ingestion_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_images_sha256 ON images (sha256_hash);
CREATE INDEX IF NOT EXISTS idx_images_imported ON images (imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_favorite ON images (favorite) WHERE favorite = true;
CREATE INDEX IF NOT EXISTS idx_images_source_tool ON images (source_tool);
CREATE INDEX IF NOT EXISTS idx_images_rating ON images (rating);
CREATE INDEX IF NOT EXISTS idx_images_phash ON images (perceptual_hash);

-- --- models / checkpoints / loras -----------------------------------------
CREATE TABLE IF NOT EXISTS models (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  family        TEXT,
  version       TEXT,
  metadata_json JSONB,
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  model_id      UUID REFERENCES models(id) ON DELETE SET NULL,
  version       TEXT,
  hash          TEXT,
  metadata_json JSONB,
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS loras (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  version       TEXT,
  hash          TEXT,
  base_model    TEXT,
  metadata_json JSONB,
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS image_loras (
  image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  lora_id  UUID NOT NULL REFERENCES loras(id)  ON DELETE CASCADE,
  weight   REAL,
  source   TEXT,
  PRIMARY KEY (image_id, lora_id)
);

-- image -> checkpoint convenience link (1:N via column on generation_params,
-- but we also keep a denormalised checkpoint_id on images for fast filtering)
ALTER TABLE images ADD COLUMN IF NOT EXISTS checkpoint_id UUID REFERENCES checkpoints(id) ON DELETE SET NULL;
ALTER TABLE images ADD COLUMN IF NOT EXISTS model_id UUID REFERENCES models(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_images_checkpoint ON images (checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_images_model ON images (model_id);

-- --- tags -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  category        TEXT,
  description     TEXT,
  source          TEXT,
  UNIQUE (normalized_name)
);
CREATE INDEX IF NOT EXISTS idx_tags_category ON tags (category);

CREATE TABLE IF NOT EXISTS image_tags (
  image_id   UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  confidence REAL,
  source     TEXT NOT NULL DEFAULT 'prompt',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (image_id, tag_id, source)
);
CREATE INDEX IF NOT EXISTS idx_image_tags_tag ON image_tags (tag_id);

-- tag aliases (Phase 14 data-quality: red eyes -> red_eyes)
CREATE TABLE IF NOT EXISTS tag_aliases (
  alias_tag_id     UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  canonical_tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (alias_tag_id, canonical_tag_id)
);

-- --- generation params ----------------------------------------------------
CREATE TABLE IF NOT EXISTS generation_params (
  image_id      UUID PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
  seed          BIGINT,
  steps         INTEGER,
  cfg_scale     REAL,
  sampler       TEXT,
  scheduler     TEXT,
  denoise       REAL,
  width         INTEGER,
  height        INTEGER,
  clip_skip     INTEGER,
  metadata_json JSONB
);
CREATE INDEX IF NOT EXISTS idx_genparams_seed ON generation_params (seed);

-- --- variants / lineage ---------------------------------------------------
CREATE TABLE IF NOT EXISTS image_variants (
  source_image_id  UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  derived_image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  relation_type    TEXT NOT NULL,
  confidence       REAL,
  source           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_image_id, derived_image_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_variants_derived ON image_variants (derived_image_id);

-- --- descriptions (external enrichment, kept separate from canonical data) -
CREATE TABLE IF NOT EXISTS image_descriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id      UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  description   TEXT NOT NULL,
  provider      TEXT,
  model         TEXT,
  prompt_used   TEXT,
  confidence    REAL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata_json JSONB
);
CREATE INDEX IF NOT EXISTS idx_descriptions_image ON image_descriptions (image_id);

-- --- ingestion jobs -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_path     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  total_files     INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  failed_files    INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  config_json     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON ingestion_jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON ingestion_jobs (created_at DESC);

-- track per-file failures for UI surfacing
CREATE TABLE IF NOT EXISTS ingestion_job_files (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     UUID NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
  file_path  TEXT NOT NULL,
  status     TEXT NOT NULL,
  error      TEXT,
  image_id   UUID REFERENCES images(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobfiles_job ON ingestion_job_files (job_id);
"""


# ---------------------------------------------------------------------------
# New catalog-service tables.
#
# Identity note: the cross-service image id is the full SHA-256 hex of the raw
# bytes (lowercase, 64 chars) — see id-scheme/README.md. The catalog stores it
# as CHAR(64). image_references is keyed by that sha256.
# ---------------------------------------------------------------------------
CATALOG_SCHEMA = r"""
-- Per-image asset references {kind, name, hash?}, keyed by the cross-service
-- sha256 id. Mirrors the AssetRef DTO in contracts/catalog.openapi.yaml.
CREATE TABLE IF NOT EXISTS image_references (
  sha256    CHAR(64) NOT NULL,
  kind      TEXT NOT NULL,
  name      TEXT NOT NULL,
  hash      TEXT,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sha256, kind, name)
);
CREATE INDEX IF NOT EXISTS idx_image_references_sha256 ON image_references (sha256);
CREATE INDEX IF NOT EXISTS idx_image_references_kind ON image_references (kind);

-- Editor.js block documents (positive/negative + body) with ordered image refs.
CREATE TABLE IF NOT EXISTS notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT,
  positive   TEXT,
  negative   TEXT,
  blocks     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ordered image refs for a note, by sha256 (the cross-service id).
CREATE TABLE IF NOT EXISTS note_image_refs (
  note_id  UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  sha256   CHAR(64) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (note_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_note_image_refs_sha256 ON note_image_refs (sha256);
CREATE INDEX IF NOT EXISTS idx_note_image_refs_order ON note_image_refs (note_id, position);

-- Manual, ordered groups of images.
CREATE TABLE IF NOT EXISTS collections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ordered collection membership, by sha256 (the cross-service id).
CREATE TABLE IF NOT EXISTS collection_images (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  sha256        CHAR(64) NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_collection_images_sha256 ON collection_images (sha256);
CREATE INDEX IF NOT EXISTS idx_collection_images_order ON collection_images (collection_id, position);
"""


def upgrade() -> None:
    op.execute(PORTED_SCHEMA)
    op.execute(CATALOG_SCHEMA)


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS collection_images;
        DROP TABLE IF EXISTS collections;
        DROP TABLE IF EXISTS note_image_refs;
        DROP TABLE IF EXISTS notes;
        DROP TABLE IF EXISTS image_references;

        DROP TABLE IF EXISTS ingestion_job_files;
        DROP TABLE IF EXISTS ingestion_jobs;
        DROP TABLE IF EXISTS image_descriptions;
        DROP TABLE IF EXISTS image_variants;
        DROP TABLE IF EXISTS generation_params;
        DROP TABLE IF EXISTS tag_aliases;
        DROP TABLE IF EXISTS image_tags;
        DROP TABLE IF EXISTS tags;
        DROP TABLE IF EXISTS image_loras;
        DROP TABLE IF EXISTS loras;
        DROP TABLE IF EXISTS checkpoints;
        DROP TABLE IF EXISTS models;
        DROP TABLE IF EXISTS images;
        """
    )
