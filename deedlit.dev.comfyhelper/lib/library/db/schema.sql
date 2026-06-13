-- ===========================================================================
-- Image Library canonical schema (PostgreSQL = source of truth)
-- Idempotent: safe to run on every startup.
-- ===========================================================================

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
