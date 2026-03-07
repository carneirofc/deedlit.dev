"use client";

import { LuFileText } from "react-icons/lu";
import { useNotesQuery } from "@/lib/queries/use-notes";

export default function NotesLandingPage() {
  const { data: notes } = useNotesQuery();

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="text-center">
        <LuFileText className="mx-auto mb-3 h-12 w-12 text-[color:var(--ui-ink-subtle)]" />
        <p className="text-ui-sm text-[color:var(--ui-ink-subtle)]">
          {notes && notes.length > 0
            ? "Select a note to start editing"
            : "Create your first prompt note"}
        </p>
      </div>
    </div>
  );
}
