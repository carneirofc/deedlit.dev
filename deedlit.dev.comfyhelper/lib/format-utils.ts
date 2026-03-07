/**
 * Shared formatting utilities used across pages.
 */

export function toFriendlyDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function toFriendlySize(bytes: number | null): string {
  if (bytes === null) {
    return "Unknown";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function stringifyMetadata(metadata: unknown): string {
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return "Metadata exists but could not be serialized.";
  }
}
