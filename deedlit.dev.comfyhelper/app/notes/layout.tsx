"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { LuChevronsLeft, LuChevronsRight, LuPlus } from "react-icons/lu";

import { OutlineButton, EmptyState, TextInput, Modal } from "@deedlit.dev/ui";
import { useNotesQuery, useCreateNoteMutation } from "@/lib/queries/use-notes";
import { cn } from "@/lib/utils";

export default function NotesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const activeNoteId = params.id ?? null;

  const { data: notes, isLoading } = useNotesQuery();
  const createNote = useCreateNoteMutation();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleCreateNote = async () => {
    const title = newNoteTitle.trim();
    if (!title) return;
    try {
      const note = await createNote.mutateAsync(title);
      setNewNoteTitle("");
      setShowCreateModal(false);
      router.push(`/notes/${note.id}`);
    } catch {
      // Error handled by mutation
    }
  };

  return (
    <section
      id="notes-page"
      data-testid="notes-page"
      className="cyber-panel flex min-h-[calc(100dvh-2rem)] flex-col rounded-[28px] p-0 sm:flex-row"
    >
      {/* Sidebar */}
      <div
        className={cn(
          "shrink-0 border-b border-[color:var(--ui-border)] sm:border-b-0 sm:border-r",
          isSidebarOpen ? "w-full sm:w-[280px]" : "w-full sm:w-[52px]",
        )}
      >
        <div className="flex items-center justify-between border-b border-[color:var(--ui-border)] px-3 py-3 sm:px-4">
          <button
            type="button"
            onClick={() => setIsSidebarOpen((v) => !v)}
            className="hidden rounded-md p-1 text-[color:var(--ui-ink-subtle)] transition hover:bg-[color:var(--ui-bg-soft)] sm:block"
            aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            {isSidebarOpen ? <LuChevronsLeft className="h-4 w-4" /> : <LuChevronsRight className="h-4 w-4" />}
          </button>
          {isSidebarOpen && (
            <>
              <h2 className="text-ui-sm font-semibold text-[color:var(--ui-ink-title)]">
                Prompt Notes
              </h2>
              <OutlineButton
                type="button"
                onClick={() => setShowCreateModal(true)}
                controlSize="sm"
              >
                <LuPlus className="mr-1 h-3.5 w-3.5" />
                New
              </OutlineButton>
            </>
          )}
          {!isSidebarOpen && (
            <OutlineButton
              type="button"
              onClick={() => setShowCreateModal(true)}
              controlSize="icon"
              aria-label="New note"
              className="sm:mx-auto"
            >
              <LuPlus className="h-4 w-4" />
            </OutlineButton>
          )}
        </div>

        {isSidebarOpen && (
          <nav className="custom-scrollbar max-h-[30vh] overflow-y-auto sm:max-h-[calc(100dvh-8rem)]">
            {isLoading && (
              <p className="p-4 text-ui-xs text-[color:var(--ui-ink-subtle)]">Loading...</p>
            )}

            {!isLoading && (!notes || notes.length === 0) && (
              <div className="p-4">
                <EmptyState testId="notes-empty-list" tone="subtle">
                  No notes yet. Create one to get started.
                </EmptyState>
              </div>
            )}

            {notes?.map((note) => (
              <Link
                key={note.id}
                href={`/notes/${note.id}`}
                className={cn(
                  "flex w-full flex-col gap-0.5 border-b border-[color:var(--ui-border-soft)] px-4 py-3 text-left transition",
                  activeNoteId === note.id
                    ? "bg-[color:var(--ui-bg-soft)]"
                    : "hover:bg-[color:var(--ui-bg-soft)]/50",
                )}
              >
                <span
                  className={cn(
                    "truncate text-ui-sm font-medium",
                    activeNoteId === note.id
                      ? "text-[color:var(--ui-ink-strong)]"
                      : "text-[color:var(--ui-ink)]",
                  )}
                >
                  {note.title}
                </span>
                <span className="text-ui-xs text-[color:var(--ui-ink-subtle)]">
                  {note.imageCount} image{note.imageCount === 1 ? "" : "s"}
                  {" · "}
                  {new Date(note.updatedAt).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </nav>
        )}
      </div>

      {/* Main content */}
      <div className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>

      {/* Create note modal */}
      <Modal
        open={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setNewNoteTitle("");
        }}
        title="New Prompt Note"
        closeLabel="Close create note dialog"
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <OutlineButton
              type="button"
              onClick={() => {
                setShowCreateModal(false);
                setNewNoteTitle("");
              }}
              disabled={createNote.isPending}
            >
              Cancel
            </OutlineButton>
            <OutlineButton
              type="button"
              variant="accent"
              onClick={() => void handleCreateNote()}
              disabled={!newNoteTitle.trim() || createNote.isPending}
            >
              {createNote.isPending ? "Creating..." : "Create"}
            </OutlineButton>
          </div>
        }
      >
        <div>
          <label htmlFor="new-note-title" className="mb-1.5 block text-ui-xs font-medium text-[color:var(--ui-ink-subtle)]">
            Note Title
          </label>
          <TextInput
            id="new-note-title"
            name="newNoteTitle"
            value={newNoteTitle}
            onChange={(e) => setNewNoteTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateNote();
            }}
            placeholder="My new prompt..."
            className="w-full"
            autoFocus
          />
        </div>
      </Modal>
    </section>
  );
}

