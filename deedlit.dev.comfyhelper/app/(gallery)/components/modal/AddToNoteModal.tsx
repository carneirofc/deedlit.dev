"use client";

import { useState } from "react";

import { Modal, OutlineButton, TextInput, EmptyState, CheckIcon, PlusIcon } from "@deedlit.dev/ui";
import { cn } from "@/lib/utils";

export type NoteListItem = {
  id: string;
  title: string;
  imageCount: number;
};

type AddToNoteModalProps = {
  open: boolean;
  onClose: () => void;
  notes: NoteListItem[] | undefined;
  isLoading: boolean;
  onAddToNote: (noteId: string) => Promise<void>;
  onCreateAndAdd: (title: string) => Promise<void>;
};

export default function AddToNoteModal({
  open,
  onClose,
  notes,
  isLoading,
  onAddToNote,
  onCreateAndAdd,
}: AddToNoteModalProps) {
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [successNoteId, setSuccessNoteId] = useState<string | null>(null);

  const handleAddToNote = async (noteId: string) => {
    setIsAdding(noteId);
    try {
      await onAddToNote(noteId);
      setSuccessNoteId(noteId);
      setTimeout(() => setSuccessNoteId(null), 1500);
    } catch {
      // Error handled by caller
    } finally {
      setIsAdding(null);
    }
  };

  const handleCreateAndAdd = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setIsAdding("__new__");
    try {
      await onCreateAndAdd(title);
      setNewTitle("");
      setShowCreate(false);
      // We don't know the new note ID here, so just reset
    } catch {
      // Error handled by caller
    } finally {
      setIsAdding(null);
    }
  };

  const handleClose = () => {
    setShowCreate(false);
    setNewTitle("");
    setSuccessNoteId(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add to Prompt Note"
      closeLabel="Close add to note dialog"
      size="sm"
    >
      <div className="space-y-3">
        {isLoading && (
          <p className="text-ui-sm text-[color:var(--ui-ink-subtle)]">Loading notes...</p>
        )}

        {!isLoading && (!notes || notes.length === 0) && !showCreate && (
          <EmptyState testId="add-to-note-empty" tone="subtle">
            No notes yet.
          </EmptyState>
        )}

        {!isLoading && notes && notes.length > 0 && (
          <div className="max-h-[40vh] space-y-1 overflow-y-auto">
            {notes.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => void handleAddToNote(note.id)}
                disabled={isAdding !== null}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition",
                  successNoteId === note.id
                    ? "bg-[color:var(--ui-bg-success)] text-[color:var(--ui-success)]"
                    : "hover:bg-[color:var(--ui-bg-soft)]",
                )}
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-ui-sm font-medium text-[color:var(--ui-ink)]">
                    {note.title}
                  </span>
                  <span className="text-ui-xs text-[color:var(--ui-ink-subtle)]">
                    {note.imageCount} image{note.imageCount === 1 ? "" : "s"}
                  </span>
                </div>
                {isAdding === note.id ? (
                  <span className="shrink-0 text-ui-xs text-[color:var(--ui-ink-subtle)]">Adding...</span>
                ) : successNoteId === note.id ? (
                  <CheckIcon size="h-5 w-5" />
                ) : (
                  <PlusIcon size="h-4 w-4" className="stroke-[color:var(--ui-ink-subtle)]" />
                )}
              </button>
            ))}
          </div>
        )}

        {showCreate ? (
          <div className="flex items-end gap-2 rounded-lg border border-[color:var(--ui-border)] p-3">
            <div className="flex-1">
              <label htmlFor="add-to-note-new-title" className="mb-1 block text-ui-xs text-[color:var(--ui-ink-subtle)]">
                New Note Title
              </label>
              <TextInput
                id="add-to-note-new-title"
                name="newNoteTitle"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreateAndAdd();
                }}
                placeholder="My prompt..."
                className="w-full"
                autoFocus
              />
            </div>
            <OutlineButton
              type="button"
              variant="accent"
              onClick={() => void handleCreateAndAdd()}
              disabled={!newTitle.trim() || isAdding !== null}
              controlSize="sm"
            >
              {isAdding === "__new__" ? "..." : "Create & Add"}
            </OutlineButton>
          </div>
        ) : (
          <OutlineButton
            type="button"
            onClick={() => setShowCreate(true)}
            className="w-full"
            controlSize="sm"
          >
            <PlusIcon size="h-3.5 w-3.5" className="mr-1" strokeWidth={2.5} />
            Create New Note
          </OutlineButton>
        )}
      </div>
    </Modal>
  );
}

