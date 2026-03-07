-- CreateTable
CREATE TABLE "root_directories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "path_norm" TEXT NOT NULL,
    "created_at_ms" INTEGER NOT NULL,
    "is_visible" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updated_at_ms" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "image_cache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "root_id" TEXT NOT NULL,
    "root_path" TEXT NOT NULL,
    "absolute_path" TEXT NOT NULL,
    "relative_path" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "modified_at_ms" INTEGER NOT NULL,
    "modified_at" TEXT NOT NULL,
    "metadata_path" TEXT,
    "metadata_json" TEXT,
    "prompt_summary_json" TEXT,
    "metadata_error" TEXT,
    "last_seen_job_id" TEXT,
    "created_at_ms" INTEGER NOT NULL,
    "updated_at_ms" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "scan_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "total_files" INTEGER NOT NULL DEFAULT 0,
    "processed_files" INTEGER NOT NULL DEFAULT 0,
    "cached_images" INTEGER NOT NULL DEFAULT 0,
    "warnings_json" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "created_at_ms" INTEGER NOT NULL,
    "started_at_ms" INTEGER,
    "finished_at_ms" INTEGER,
    "updated_at_ms" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "root_directories_path_norm_key" ON "root_directories"("path_norm");

-- CreateIndex
CREATE INDEX "idx_image_cache_root" ON "image_cache"("root_id");

-- CreateIndex
CREATE INDEX "idx_image_cache_modified" ON "image_cache"("modified_at_ms" DESC);

-- CreateIndex
CREATE INDEX "idx_scan_jobs_created" ON "scan_jobs"("created_at_ms" DESC);
