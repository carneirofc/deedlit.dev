import { randomUUID } from "node:crypto";

import { prisma, ensureDatabase } from "@/lib/db/client";
import { PromptNoteSchema, PromptNoteSummarySchema } from "@/lib/contracts/notes";
import { StoreError } from "@/lib/http/errors";
import type { PromptNote, PromptNoteSummary, EditorJsData } from "@/lib/notes-types";
import { nowMs, toIsoDateTime } from "@/lib/time-utils";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class NoteStoreError extends StoreError {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_EDITOR_DATA = JSON.stringify({ blocks: [] });

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { blocks: [] };
  }
}

type NoteRow = {
  id: string;
  title: string;
  positivePromptJson: string;
  negativePromptJson: string;
  notesJson: string;
  sortOrder: number;
  createdAtMs: number;
  updatedAtMs: number;
  images: Array<{
    id: string;
    imageCacheId: string;
    sortOrder: number;
    addedAtMs: number;
  }>;
};

type NoteSummaryRow = {
  id: string;
  title: string;
  sortOrder: number;
  createdAtMs: number;
  updatedAtMs: number;
  _count: { images: number };
};

function toPromptNote(row: NoteRow): PromptNote {
  return PromptNoteSchema.parse({
    id: row.id,
    title: row.title,
    positivePrompt: safeParseJson(row.positivePromptJson),
    negativePrompt: safeParseJson(row.negativePromptJson),
    notes: safeParseJson(row.notesJson),
    sortOrder: row.sortOrder,
    createdAt: toIsoDateTime(row.createdAtMs),
    updatedAt: toIsoDateTime(row.updatedAtMs),
    images: row.images.map((img) => ({
      id: img.id,
      imageCacheId: img.imageCacheId,
      sortOrder: img.sortOrder,
      addedAt: toIsoDateTime(img.addedAtMs),
    })),
  });
}

function toPromptNoteSummary(row: NoteSummaryRow): PromptNoteSummary {
  return PromptNoteSummarySchema.parse({
    id: row.id,
    title: row.title,
    sortOrder: row.sortOrder,
    createdAt: toIsoDateTime(row.createdAtMs),
    updatedAt: toIsoDateTime(row.updatedAtMs),
    imageCount: row._count.images,
  });
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export async function listNotes(): Promise<PromptNoteSummary[]> {
  await ensureDatabase();

  const rows = await prisma.promptNote.findMany({
    orderBy: [{ sortOrder: "asc" }, { updatedAtMs: "desc" }],
    include: { _count: { select: { images: true } } },
  });

  return rows.map(toPromptNoteSummary);
}

export async function getNote(id: string): Promise<PromptNote> {
  await ensureDatabase();

  const row = await prisma.promptNote.findUnique({
    where: { id },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });

  if (!row) {
    throw new NoteStoreError("Note not found.", 404);
  }

  return toPromptNote(row);
}

export async function createNote(title: string): Promise<PromptNote> {
  await ensureDatabase();

  const id = randomUUID();
  const timestamp = nowMs();

  const row = await prisma.promptNote.create({
    data: {
      id,
      title,
      positivePromptJson: EMPTY_EDITOR_DATA,
      negativePromptJson: EMPTY_EDITOR_DATA,
      notesJson: EMPTY_EDITOR_DATA,
      sortOrder: 0,
      createdAtMs: timestamp,
      updatedAtMs: timestamp,
    },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });

  return toPromptNote(row);
}

type UpdateNoteData = {
  title?: string;
  positivePrompt?: EditorJsData;
  negativePrompt?: EditorJsData;
  notes?: EditorJsData;
  sortOrder?: number;
};

export async function updateNote(id: string, data: UpdateNoteData): Promise<PromptNote> {
  await ensureDatabase();

  const existing = await prisma.promptNote.findUnique({ where: { id } });
  if (!existing) {
    throw new NoteStoreError("Note not found.", 404);
  }

  const updateFields: Record<string, unknown> = {
    updatedAtMs: nowMs(),
  };

  if (data.title !== undefined) {
    updateFields.title = data.title;
  }
  if (data.positivePrompt !== undefined) {
    updateFields.positivePromptJson = JSON.stringify(data.positivePrompt);
  }
  if (data.negativePrompt !== undefined) {
    updateFields.negativePromptJson = JSON.stringify(data.negativePrompt);
  }
  if (data.notes !== undefined) {
    updateFields.notesJson = JSON.stringify(data.notes);
  }
  if (data.sortOrder !== undefined) {
    updateFields.sortOrder = data.sortOrder;
  }

  const row = await prisma.promptNote.update({
    where: { id },
    data: updateFields,
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });

  return toPromptNote(row);
}

export async function deleteNote(id: string): Promise<void> {
  await ensureDatabase();

  const deleted = await prisma.promptNote.deleteMany({ where: { id } });

  if (deleted.count === 0) {
    throw new NoteStoreError("Note not found.", 404);
  }
}

// ---------------------------------------------------------------------------
// Image association
// ---------------------------------------------------------------------------

export async function addImageToNote(noteId: string, imageCacheId: string): Promise<PromptNote> {
  await ensureDatabase();

  const note = await prisma.promptNote.findUnique({ where: { id: noteId } });
  if (!note) {
    throw new NoteStoreError("Note not found.", 404);
  }

  const existing = await prisma.promptNoteImage.findFirst({
    where: { noteId, imageCacheId },
  });

  if (!existing) {
    const maxSort = await prisma.promptNoteImage.aggregate({
      where: { noteId },
      _max: { sortOrder: true },
    });

    await prisma.promptNoteImage.create({
      data: {
        id: randomUUID(),
        noteId,
        imageCacheId,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        addedAtMs: nowMs(),
      },
    });
  }

  return getNote(noteId);
}

export async function removeImageFromNote(noteId: string, imageCacheId: string): Promise<PromptNote> {
  await ensureDatabase();

  const note = await prisma.promptNote.findUnique({ where: { id: noteId } });
  if (!note) {
    throw new NoteStoreError("Note not found.", 404);
  }

  await prisma.promptNoteImage.deleteMany({
    where: { noteId, imageCacheId },
  });

  return getNote(noteId);
}

// ---------------------------------------------------------------------------
// Query: notes referencing a given image
// ---------------------------------------------------------------------------

export type NoteReference = { noteId: string; noteTitle: string };

export async function findNotesByImage(imageCacheId: string): Promise<NoteReference[]> {
  await ensureDatabase();

  const links = await prisma.promptNoteImage.findMany({
    where: { imageCacheId },
    include: { note: { select: { id: true, title: true } } },
  });

  return links.map((l) => ({ noteId: l.note.id, noteTitle: l.note.title }));
}
