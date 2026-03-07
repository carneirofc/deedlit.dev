import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { ApiErrorResponseSchema } from "@/lib/contracts/api";
import {
  NotesListResponseSchema,
  NoteDetailResponseSchema,
  CreateNoteResponseSchema,
  UpdateNoteResponseSchema,
  DeleteNoteResponseSchema,
  AddImageToNoteResponseSchema,
  RemoveImageFromNoteResponseSchema,
  NotesByImageResponseSchema,
} from "@/lib/contracts/notes-api";
import type { PromptNote, PromptNoteSummary, EditorJsData } from "@/lib/notes-types";
import { queryKeys } from "@/lib/queries/query-keys";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function throwApiError(payload: unknown, fallback: string): never {
  const parsed = ApiErrorResponseSchema.safeParse(payload);
  throw new Error(parsed.success ? parsed.data.error : fallback);
}

// ---------------------------------------------------------------------------
// List notes (summaries)
// ---------------------------------------------------------------------------

async function fetchNotes(): Promise<PromptNoteSummary[]> {
  const response = await fetch("/api/notes", { cache: "no-store" });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throwApiError(payload, "Failed to load notes.");
  return NotesListResponseSchema.parse(payload).notes;
}

export function useNotesQuery() {
  return useQuery({
    queryKey: queryKeys.notes(),
    queryFn: fetchNotes,
  });
}

// ---------------------------------------------------------------------------
// Single note detail
// ---------------------------------------------------------------------------

async function fetchNoteDetail(id: string): Promise<PromptNote> {
  const response = await fetch(`/api/notes/${encodeURIComponent(id)}`, { cache: "no-store" });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throwApiError(payload, "Failed to load note.");
  return NoteDetailResponseSchema.parse(payload).note;
}

export function useNoteDetailQuery(id: string | null) {
  return useQuery({
    queryKey: queryKeys.noteDetail(id),
    queryFn: () => fetchNoteDetail(id!),
    enabled: Boolean(id),
  });
}

// ---------------------------------------------------------------------------
// Create note
// ---------------------------------------------------------------------------

export function useCreateNoteMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (title: string) => {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) throwApiError(payload, "Failed to create note.");
      return CreateNoteResponseSchema.parse(payload).note;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes() });
    },
  });
}

// ---------------------------------------------------------------------------
// Update note
// ---------------------------------------------------------------------------

type UpdateNoteParams = {
  id: string;
  title?: string;
  positivePrompt?: EditorJsData;
  negativePrompt?: EditorJsData;
  notes?: EditorJsData;
  sortOrder?: number;
};

export function useUpdateNoteMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateNoteParams) => {
      const response = await fetch(`/api/notes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) throwApiError(payload, "Failed to update note.");
      return UpdateNoteResponseSchema.parse(payload).note;
    },
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.noteDetail(note.id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Delete note
// ---------------------------------------------------------------------------

export function useDeleteNoteMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/notes/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) throwApiError(payload, "Failed to delete note.");
      DeleteNoteResponseSchema.parse(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes() });
    },
  });
}

// ---------------------------------------------------------------------------
// Add image to note
// ---------------------------------------------------------------------------

export function useAddImageToNoteMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ noteId, imageCacheId }: { noteId: string; imageCacheId: string }) => {
      const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageCacheId }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) throwApiError(payload, "Failed to add image to note.");
      return AddImageToNoteResponseSchema.parse(payload).note;
    },
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.noteDetail(note.id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Remove image from note
// ---------------------------------------------------------------------------

export function useRemoveImageFromNoteMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ noteId, imageCacheId }: { noteId: string; imageCacheId: string }) => {
      const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}/images`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageCacheId }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) throwApiError(payload, "Failed to remove image from note.");
      return RemoveImageFromNoteResponseSchema.parse(payload).note;
    },
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.noteDetail(note.id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Notes referencing a given image
// ---------------------------------------------------------------------------

type NoteReference = { noteId: string; noteTitle: string };

async function fetchNotesByImage(imageCacheId: string): Promise<NoteReference[]> {
  const response = await fetch(`/api/notes/by-image/${encodeURIComponent(imageCacheId)}`, { cache: "no-store" });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throwApiError(payload, "Failed to load note references.");
  return NotesByImageResponseSchema.parse(payload).noteReferences;
}

export function useNotesByImageQuery(imageCacheId: string | null) {
  return useQuery({
    queryKey: queryKeys.notesByImage(imageCacheId),
    queryFn: () => fetchNotesByImage(imageCacheId!),
    enabled: Boolean(imageCacheId),
  });
}
