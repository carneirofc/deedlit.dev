import type { PromptNote, EditorJsData } from "@/lib/notes-types";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function editorJsToPlainText(data: EditorJsData): string {
  if (!data?.blocks?.length) return "";

  return data.blocks
    .map((block) => {
      switch (block.type) {
        case "paragraph":
          return stripHtml(String(block.data.text ?? ""));
        case "header":
          return stripHtml(String(block.data.text ?? ""));
        case "list": {
          const items = block.data.items;
          if (Array.isArray(items)) {
            return items
              .map((item: unknown) => `  - ${stripHtml(String(typeof item === "string" ? item : (item as Record<string, unknown>)?.content ?? ""))}`)
              .join("\n");
          }
          return "";
        }
        case "code":
          return String(block.data.code ?? "");
        default:
          return stripHtml(String(block.data.text ?? JSON.stringify(block.data)));
      }
    })
    .join("\n\n");
}

export function formatNoteExport(note: PromptNote): string {
  const lines: string[] = [];

  lines.push(`=== PROMPT NOTE: ${note.title} ===`);
  lines.push(`Created: ${note.createdAt}  |  Updated: ${note.updatedAt}`);
  lines.push("");

  lines.push("--- POSITIVE PROMPT ---");
  lines.push(editorJsToPlainText(note.positivePrompt));
  lines.push("");

  lines.push("--- NEGATIVE PROMPT ---");
  lines.push(editorJsToPlainText(note.negativePrompt));
  lines.push("");

  lines.push("--- NOTES ---");
  lines.push(editorJsToPlainText(note.notes));
  lines.push("");

  lines.push(`--- ATTACHED IMAGES (${note.images.length}) ---`);
  for (const img of note.images) {
    lines.push(`- ${img.imageCacheId}`);
  }

  return lines.join("\n");
}
