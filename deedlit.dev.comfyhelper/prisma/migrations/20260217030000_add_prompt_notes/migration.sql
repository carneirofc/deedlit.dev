-- CreateTable
CREATE TABLE "prompt_notes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "positive_prompt_json" TEXT NOT NULL DEFAULT '{}',
    "negative_prompt_json" TEXT NOT NULL DEFAULT '{}',
    "notes_json" TEXT NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at_ms" INTEGER NOT NULL,
    "updated_at_ms" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "prompt_note_images" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "note_id" TEXT NOT NULL,
    "image_cache_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "added_at_ms" INTEGER NOT NULL,
    CONSTRAINT "prompt_note_images_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "prompt_notes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "idx_prompt_notes_sort" ON "prompt_notes"("sort_order");

-- CreateIndex
CREATE INDEX "idx_prompt_notes_updated" ON "prompt_notes"("updated_at_ms" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_note_image" ON "prompt_note_images"("note_id", "image_cache_id");

-- CreateIndex
CREATE INDEX "idx_prompt_note_images_cache_id" ON "prompt_note_images"("image_cache_id");
