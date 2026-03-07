"use client";

import Link from "next/link";
import { DocumentIcon, SectionLabel } from "@deedlit.dev/ui";

export type NoteReference = {
  noteId: string;
  noteTitle: string;
};

type NoteReferencesSectionProps = {
  references: NoteReference[] | undefined;
};

export default function NoteReferencesSection({ references }: NoteReferencesSectionProps) {
  if (!references || references.length === 0) return null;

  return (
    <section className="mt-3 border-t border-ui-border-soft pt-3">
      <SectionLabel className="mb-1.5 tracking-[0.12em] text-ui-ink-subtle">
        Referenced in Notes
      </SectionLabel>
      <div className="flex flex-col gap-1">
        {references.map((ref) => (
          <Link
            key={ref.noteId}
            href={`/notes/${ref.noteId}`}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-ui-sm text-ui-ink transition hover:bg-ui-bg-soft"
          >
            <DocumentIcon size="h-3.5 w-3.5" className="shrink-0" />
            <span className="truncate">{ref.noteTitle}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

