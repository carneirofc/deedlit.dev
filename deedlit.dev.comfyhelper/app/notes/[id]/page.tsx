"use client";

import { useParams, useRouter } from "next/navigation";

import NoteEditorPane from "../components/NoteEditorPane";

export default function NoteEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  return (
    <NoteEditorPane
      key={params.id}
      noteId={params.id}
      onNoteDeleted={() => router.push("/notes")}
    />
  );
}
