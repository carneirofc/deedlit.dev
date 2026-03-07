"use client";

import { useState, useMemo, useCallback } from "react";
import Image from "next/image";
import { LuCheck } from "react-icons/lu";

import { Modal, OutlineButton, TextInput, EmptyState } from "@deedlit.dev/ui";
import { useLibraryQuery } from "@/lib/queries/use-library";
import { useAddImageToNoteMutation } from "@/lib/queries/use-notes";
import { cn } from "@/lib/utils";

type ImagePickerModalProps = {
  open: boolean;
  onClose: () => void;
  noteId: string;
  existingImageIds: Set<string>;
};

const MAX_VISIBLE_IMAGES = 200;

export default function ImagePickerModal({
  open,
  onClose,
  noteId,
  existingImageIds,
}: ImagePickerModalProps) {
  const { data: libraryData } = useLibraryQuery();
  const addImage = useAddImageToNoteMutation();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [isAdding, setIsAdding] = useState(false);

  const filteredImages = useMemo(() => {
    const images = libraryData?.images ?? [];
    const term = search.trim().toLowerCase();
    const filtered = term
      ? images.filter((img) => img.fileName.toLowerCase().includes(term))
      : images;
    return filtered.slice(0, MAX_VISIBLE_IMAGES);
  }, [libraryData?.images, search]);

  const toggleSelection = useCallback((imageId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  }, []);

  const handleAddSelected = async () => {
    if (selected.size === 0) return;
    setIsAdding(true);
    try {
      for (const imageCacheId of selected) {
        await addImage.mutateAsync({ noteId, imageCacheId });
      }
      setSelected(new Set());
      setSearch("");
      onClose();
    } catch {
      // Error handled by mutation
    } finally {
      setIsAdding(false);
    }
  };

  const handleClose = () => {
    setSelected(new Set());
    setSearch("");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add Images"
      closeLabel="Close image picker"
      size="xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <OutlineButton type="button" onClick={handleClose} disabled={isAdding}>
            Cancel
          </OutlineButton>
          <OutlineButton
            type="button"
            variant="accent"
            onClick={() => void handleAddSelected()}
            disabled={selected.size === 0 || isAdding}
          >
            {isAdding ? "Adding..." : `Add Selected (${selected.size})`}
          </OutlineButton>
        </div>
      }
    >
      <div className="space-y-3">
        <TextInput
          id="image-picker-search"
          name="imagePickerSearch"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by filename..."
          className="w-full"
        />

        {filteredImages.length === 0 ? (
          <EmptyState testId="image-picker-empty">
            {(libraryData?.images?.length ?? 0) === 0
              ? "No images in the library. Scan a root directory first."
              : "No images match your search."}
          </EmptyState>
        ) : (
          <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {filteredImages.map((image) => {
              const isExisting = existingImageIds.has(image.id);
              const isSelected = selected.has(image.id);
              return (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => {
                    if (!isExisting) toggleSelection(image.id);
                  }}
                  disabled={isExisting}
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-lg border transition",
                    isExisting
                      ? "cursor-not-allowed border-[color:var(--ui-border)] opacity-40"
                      : isSelected
                        ? "border-[color:var(--ui-accent)] ring-2 ring-[color:var(--ui-accent)]"
                        : "border-[color:var(--ui-border)] hover:border-[color:var(--ui-ink-subtle)]",
                  )}
                >
                  <Image
                    src={`/api/image?path=${encodeURIComponent(image.absolutePath)}`}
                    alt={image.fileName}
                    fill
                    className="object-cover"
                    sizes="120px"
                  />
                  {isSelected && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--ui-accent)]/20">
                      <LuCheck className="h-8 w-8 text-[color:var(--ui-accent)]" />
                    </div>
                  )}
                  {isExisting && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="rounded bg-[color:var(--ui-bg-card)]/80 px-1.5 py-0.5 text-ui-xs font-medium text-[color:var(--ui-ink-subtle)]">
                        Added
                      </span>
                    </div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-[color:var(--ui-bg-card)]/80 px-1 py-0.5 text-ui-xs text-[color:var(--ui-ink)]">
                    {image.fileName}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {filteredImages.length === MAX_VISIBLE_IMAGES && (
          <p className="text-center text-ui-xs text-[color:var(--ui-ink-subtle)]">
            Showing first {MAX_VISIBLE_IMAGES} results. Use the search to narrow down.
          </p>
        )}
      </div>
    </Modal>
  );
}

