-- CreateIndex for performance optimization
-- Critical indexes for frequently queried columns

-- Most critical: absolutePath is used for file lookups and duplicate detection
CREATE INDEX IF NOT EXISTS "idx_image_cache_path" ON "image_cache"("absolute_path");

-- Composite index for most common query pattern: filter by rootId + sort by modifiedAtMs
CREATE INDEX IF NOT EXISTS "idx_image_cache_root_modified" ON "image_cache"("root_id", "modified_at_ms" DESC);

-- Status is filtered frequently when checking for active scan jobs
CREATE INDEX IF NOT EXISTS "idx_scan_jobs_status" ON "scan_jobs"("status");

-- fileName used for search operations
CREATE INDEX IF NOT EXISTS "idx_image_cache_filename" ON "image_cache"("file_name");

-- lastSeenJobId used to track which scan job last processed each image
CREATE INDEX IF NOT EXISTS "idx_image_cache_last_job" ON "image_cache"("last_seen_job_id");

-- Composite index for displaying images within a note in sorted order
CREATE INDEX IF NOT EXISTS "idx_prompt_note_images_note_sort" ON "prompt_note_images"("note_id", "sort_order");

-- Composite index for finding recent jobs by status
CREATE INDEX IF NOT EXISTS "idx_scan_jobs_status_created" ON "scan_jobs"("status", "created_at_ms" DESC);
