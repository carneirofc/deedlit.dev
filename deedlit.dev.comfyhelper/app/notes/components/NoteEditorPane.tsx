"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { LuDownload, LuPlus, LuEye, LuX } from "react-icons/lu";

import { OutlineButton, TextInput, Modal, EmptyState } from "@deedlit.dev/ui";
import { useNoteDetailQuery, useCreateNoteMutation, useUpdateNoteMutation, useDeleteNoteMutation, useRemoveImageFromNoteMutation, useAddImageToNoteMutation } from "@/lib/queries/use-notes";
import { useLibraryQuery } from "@/lib/queries/use-library";
import { cn } from "@/lib/utils";
import type { EditorJsData } from "@/lib/notes-types";
import type { ImageRecord } from "@/lib/library-types";
import StandaloneImageModal from "@/components/StandaloneImageModal";

import ImagePickerModal from "./ImagePickerModal";

const EditorJsField = dynamic(() => import("./EditorJsField"), { ssr: false });

type NoteEditorPaneProps = {
  noteId: string;
  onNoteDeleted: () => void;
};

export default function NoteEditorPane({ noteId, onNoteDeleted }: NoteEditorPaneProps) {
  const router = useRouter();
  const { data: note, isLoading } = useNoteDetailQuery(noteId);
  const { data: libraryData } = useLibraryQuery();
  const createNote = useCreateNoteMutation();
  const updateNote = useUpdateNoteMutation();
  const deleteNote = useDeleteNoteMutation();
  const removeImage = useRemoveImageFromNoteMutation();
  const addImage = useAddImageToNoteMutation();

  const [localTitle, setLocalTitle] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showSavedIndicator, setShowSavedIndicator] = useState(false);
  const [selectedNoteImage, setSelectedNoteImage] = useState<ImageRecord | null>(null);

  // Dirty tracking
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());
  const localEditorDataRef = useRef<Record<string, EditorJsData>>({});

  const isDirty = dirtyFields.size > 0;

  // Build a lookup map of imageCacheId -> ImageRecord
  const imageRecordMap = useMemo(() => {
    const map = new Map<string, { absolutePath: string; fileName: string }>();
    for (const img of libraryData?.images ?? []) {
      map.set(img.id, { absolutePath: img.absolutePath, fileName: img.fileName });
    }
    return map;
  }, [libraryData?.images]);

  // Existing image IDs set for the picker
  const existingImageIds = useMemo(
    () => new Set((note?.images ?? []).map((img) => img.imageCacheId)),
    [note?.images],
  );

  // Sync local title when the note identity changes (not on every background refetch).
  // Using note?.id instead of note prevents overwriting live title edits when React Query
  // background-refetches and returns a new object reference for the same note.
  useEffect(() => {
    if (note) {
      setLocalTitle(note.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!note || dirtyFields.size === 0) return;

    // If the title was changed, treat save as "Save As" — create a new note
    if (dirtyFields.has("title")) {
      const newTitle = localTitle.trim();
      if (!newTitle) return;

      const contentChanges: Record<string, unknown> = {};
      if (dirtyFields.has("positivePrompt")) {
        contentChanges.positivePrompt = localEditorDataRef.current.positivePrompt;
      }
      if (dirtyFields.has("negativePrompt")) {
        contentChanges.negativePrompt = localEditorDataRef.current.negativePrompt;
      }
      if (dirtyFields.has("notes")) {
        contentChanges.notes = localEditorDataRef.current.notes;
      }

      // Also copy unchanged content fields from the original note
      if (!contentChanges.positivePrompt) contentChanges.positivePrompt = note.positivePrompt;
      if (!contentChanges.negativePrompt) contentChanges.negativePrompt = note.negativePrompt;
      if (!contentChanges.notes) contentChanges.notes = note.notes;

      try {
        const newNote = await createNote.mutateAsync(newTitle);
        if (Object.keys(contentChanges).length > 0) {
          await updateNote.mutateAsync({ id: newNote.id, ...contentChanges });
        }
        router.push(`/notes/${newNote.id}`);
      } catch {
        // Errors are surfaced via mutation state (createNote.isError / updateNote.isError)
      }
      return;
    }

    // Title unchanged — update in place
    const changes: Record<string, unknown> = {};
    if (dirtyFields.has("positivePrompt")) {
      changes.positivePrompt = localEditorDataRef.current.positivePrompt;
    }
    if (dirtyFields.has("negativePrompt")) {
      changes.negativePrompt = localEditorDataRef.current.negativePrompt;
    }
    if (dirtyFields.has("notes")) {
      changes.notes = localEditorDataRef.current.notes;
    }

    if (Object.keys(changes).length > 0) {
      updateNote.mutate(
        { id: noteId, ...changes },
        {
          onSuccess: () => {
            setDirtyFields(new Set());
            setShowSavedIndicator(true);
            setTimeout(() => setShowSavedIndicator(false), 2000);
          },
        },
      );
    }
  }, [note, noteId, dirtyFields, localTitle, createNote, updateNote, router]);

  // Ctrl+S / Cmd+S keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  // Warn on unsaved changes before unload
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const markDirty = useCallback((field: string) => {
    setDirtyFields((prev) => {
      if (prev.has(field)) return prev;
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  }, []);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalTitle(e.target.value);
    markDirty("title");
  };

  const handleEditorChange = useCallback(
    (field: "positivePrompt" | "negativePrompt" | "notes") => (data: EditorJsData) => {
      localEditorDataRef.current[field] = data;
      markDirty(field);
    },
    [markDirty],
  );

  const handleDelete = async () => {
    setShowDeleteModal(false);
    await deleteNote.mutateAsync(noteId);
    onNoteDeleted();
  };

  const handleExport = () => {
    window.open(`/api/notes/${encodeURIComponent(noteId)}/export`, "_blank");
  };

  const handleRemoveImage = (imageCacheId: string) => {
    removeImage.mutate({ noteId, imageCacheId });
  };

  // Drag-and-drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const imageCacheId = e.dataTransfer.getData("text/plain");
    if (imageCacheId && noteId) {
      addImage.mutate({ noteId, imageCacheId });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-ui-sm text-[color:var(--ui-ink-subtle)]">Loading note...</p>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState testId="note-not-found">Note not found.</EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <TextInput
            id="note-title-input"
            name="noteTitle"
            value={localTitle}
            onChange={handleTitleChange}
            placeholder="Note title..."
            className="flex-1 text-ui-lg font-semibold"
          />
          {isDirty && (
            <span className="shrink-0 text-ui-xs text-[color:var(--ui-ink-subtle)]">Unsaved</span>
          )}
          {showSavedIndicator && !isDirty && (
            <span className="shrink-0 text-ui-xs text-[color:var(--ui-success)]">Saved</span>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <OutlineButton
            type="button"
            variant="accent"
            onClick={handleSave}
            controlSize="sm"
            disabled={!isDirty || updateNote.isPending || createNote.isPending}
          >
            {(updateNote.isPending || createNote.isPending) ? "Saving..." : "Save"}
          </OutlineButton>
          <OutlineButton 
            type="button" 
            variant="neutral"
            onClick={handleExport} controlSize="sm">
            <LuDownload className="mr-1.5 h-4 w-4" />
            Export TXT
          </OutlineButton>
          <OutlineButton
            type="button"
            variant="neutral"
            onClick={() => setShowDeleteModal(true)}
            // controlSize="sm"
            disabled={deleteNote.isPending}
          >
            Delete
          </OutlineButton>
        </div>
      </div>

      {/* Positive Prompt */}
      <section>
        <h3 className="mb-2 text-ui-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--ui-ink-subtle)]">
          Positive Prompt
        </h3>
        <EditorJsField
          key={`${noteId}-positive`}
          id={`${noteId}-positive`}
          initialData={note.positivePrompt}
          onChange={handleEditorChange("positivePrompt")}
          placeholder="Enter positive prompt..."
          toolset="prompt"
          minHeight={100}
          readOnly={false}
        />
      </section>

      {/* Negative Prompt */}
      <section>
        <h3 className="mb-2 text-ui-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--ui-ink-subtle)]">
          Negative Prompt
        </h3>
        <EditorJsField
          key={`${noteId}-negative`}
          id={`${noteId}-negative`}
          initialData={note.negativePrompt}
          onChange={handleEditorChange("negativePrompt")}
          placeholder="Enter negative prompt..."
          toolset="prompt"
          minHeight={80}
          readOnly={false}
        />
      </section>

      {/* Notes */}
      <section>
        <h3 className="mb-2 text-ui-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--ui-ink-subtle)]">
          Notes
        </h3>
        <EditorJsField
          key={`${noteId}-notes`}
          id={`${noteId}-notes`}
          initialData={note.notes}
          onChange={handleEditorChange("notes")}
          placeholder="Freeform notes, lists, headers..."
          toolset="full"
          minHeight={120}
          readOnly={false}
        />
      </section>

      {/* Attached Images */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-ui-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--ui-ink-subtle)]">
            Attached Images ({note.images.length})
          </h3>
          <OutlineButton type="button" onClick={() => setShowImagePicker(true)} controlSize="sm">
            <LuPlus className="mr-1 h-4 w-4" />
            Add Images
          </OutlineButton>
        </div>

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "min-h-[80px] rounded-xl border-2 border-dashed p-3 transition",
            isDragOver
              ? "border-[color:var(--ui-accent)] bg-[color:var(--ui-accent)]/5"
              : "border-[color:var(--ui-border-soft)]",
          )}
        >
          {note.images.length === 0 ? (
            <p className="py-4 text-center text-ui-sm text-[color:var(--ui-ink-subtle)]">
              No images attached. Click &quot;Add Images&quot; or drag images here.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {note.images.map((noteImage) => {
                const resolved = imageRecordMap.get(noteImage.imageCacheId);
                return (
                  <div key={noteImage.id} className="group relative aspect-square overflow-hidden rounded-lg border border-[color:var(--ui-border)]">
                    {resolved ? (
                      <Image
                        src={`/api/image?path=${encodeURIComponent(resolved.absolutePath)}`}
                        alt={resolved.fileName}
                        fill
                        className="object-cover"
                        sizes="120px"
                        quality={75}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-[color:var(--ui-bg-muted)] p-2">
                        <span className="text-center text-ui-xs text-[color:var(--ui-ink-subtle)]">
                          Not in library
                        </span>
                      </div>
                    )}
                    {/* Overlay buttons on hover */}
                    <div className="absolute inset-0 hidden items-end justify-center gap-1 bg-black/30 p-1.5 group-hover:flex">
                      {resolved && (
                        <button
                          type="button"
                          onClick={() => {
                            const fullRecord = libraryData?.images?.find((img) => img.id === noteImage.imageCacheId);
                            if (fullRecord) setSelectedNoteImage(fullRecord);
                          }}
                          className="rounded-full bg-[color:var(--ui-bg-card)]/90 p-1.5 text-[color:var(--ui-ink-subtle)] transition hover:text-[color:var(--ui-ink)]"
                          aria-label="View image details"
                          title="View image details"
                        >
                          <LuEye className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(noteImage.imageCacheId)}
                        className="rounded-full bg-[color:var(--ui-bg-card)]/90 p-1.5 text-[color:var(--ui-ink-subtle)] transition hover:text-[color:var(--ui-error)]"
                        aria-label="Remove image"
                        title="Remove from note"
                      >
                        <LuX className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Delete confirmation */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Note"
        description={`Delete "${note.title}"?`}
        closeLabel="Close delete confirmation"
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <OutlineButton type="button" onClick={() => setShowDeleteModal(false)} disabled={deleteNote.isPending}>
              Cancel
            </OutlineButton>
            <OutlineButton
              type="button"
              variant="danger"
              onClick={() => void handleDelete()}
              disabled={deleteNote.isPending}
            >
              {deleteNote.isPending ? "Deleting..." : "Delete"}
            </OutlineButton>
          </div>
        }
      >
        <p className="text-ui-sm text-[color:var(--ui-ink-subtle)]">
          This action cannot be undone. The note and all image associations will be permanently removed.
        </p>
      </Modal>

      {/* Image picker */}
      <ImagePickerModal
        open={showImagePicker}
        onClose={() => setShowImagePicker(false)}
        noteId={noteId}
        existingImageIds={existingImageIds}
      />

      {/* Standalone image details modal */}
      <StandaloneImageModal
        image={selectedNoteImage}
        onClose={() => setSelectedNoteImage(null)}
      />
    </div>
  );
}

