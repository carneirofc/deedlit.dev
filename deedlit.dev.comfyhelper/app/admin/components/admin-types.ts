// Re-export SSE types from the shared store so existing imports keep working.
export type { SseConnectionState as SocketConnectionState, SseLastEvent as SocketLastEvent } from "@/lib/store/scan-atoms";

// Re-export from UI package for backward compatibility with existing admin imports.
export type { ConfirmationDialogData as DetailedConfirmation } from "@deedlit.dev/ui";

export type EndpointHealth = {
  id: string;
  path: string;
  ok: boolean | null;
  status: number | null;
  latencyMs: number | null;
  checkedAt: string | null;
  error: string | null;
};

