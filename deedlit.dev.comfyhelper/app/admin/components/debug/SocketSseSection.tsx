"use client";

import { useAtomValue } from "jotai";

import { toFriendlyDate } from "@/lib/format-utils";
import {
  sseConnectionStateAtom,
  sseReadyStateAtom,
  sseOpenCountAtom,
  sseErrorCountAtom,
  sseMalformedCountAtom,
  sseTaskEventCountAtom,
  sseSnapshotCountAtom,
  sseOpenedAtAtom,
  sseLastEventAtAtom,
  sseLastSnapshotAtAtom,
  sseLastErrorAtAtom,
  sseLastEventAtom,
  sseEventSourceAttachedAtom,
  type SseConnectionState,
} from "@/lib/store/scan-atoms";

import DebugSection from "./DebugSection";
import { DebugField, DebugFieldGrid, StatusText } from "./DebugField";

function toSocketReadyStateLabel(value: number | null): string {
  if (value === 0) return "CONNECTING";
  if (value === 1) return "OPEN";
  if (value === 2) return "CLOSED";
  return "UNKNOWN";
}

function connectionColor(state: SseConnectionState) {
  if (state === "open") return "success" as const;
  if (state === "connecting") return "warning" as const;
  return "danger" as const;
}

export default function SocketSseSection() {
  const socketConnectionState = useAtomValue(sseConnectionStateAtom);
  const socketReadyState = useAtomValue(sseReadyStateAtom);
  const socketOpenCount = useAtomValue(sseOpenCountAtom);
  const socketErrorCount = useAtomValue(sseErrorCountAtom);
  const socketMalformedCount = useAtomValue(sseMalformedCountAtom);
  const socketTaskEventCount = useAtomValue(sseTaskEventCountAtom);
  const socketSnapshotCount = useAtomValue(sseSnapshotCountAtom);
  const socketOpenedAt = useAtomValue(sseOpenedAtAtom);
  const socketLastEventAt = useAtomValue(sseLastEventAtAtom);
  const socketLastSnapshotAt = useAtomValue(sseLastSnapshotAtAtom);
  const socketLastErrorAt = useAtomValue(sseLastErrorAtAtom);
  const socketLastEvent = useAtomValue(sseLastEventAtom);
  const eventSourceAttached = useAtomValue(sseEventSourceAttachedAtom);

  return (
    <DebugSection title="Socket / SSE">
      <DebugFieldGrid>
        <DebugField label="Connection">
          <StatusText color={connectionColor(socketConnectionState)}>{socketConnectionState}</StatusText>
        </DebugField>
        <DebugField label="Ready state">
          {toSocketReadyStateLabel(socketReadyState)} ({socketReadyState ?? "n/a"})
        </DebugField>
        <DebugField label="Source handle">{eventSourceAttached ? "attached" : "none"}</DebugField>
        <DebugField label="Opens / Errors">
          {socketOpenCount} / {socketErrorCount}
        </DebugField>
        <DebugField label="Task events">{socketTaskEventCount}</DebugField>
        <DebugField label="Snapshots">{socketSnapshotCount}</DebugField>
        <DebugField label="Malformed payloads">{socketMalformedCount}</DebugField>
        <DebugField label="Last open">{socketOpenedAt ? toFriendlyDate(socketOpenedAt) : "never"}</DebugField>
        <DebugField label="Last event">{socketLastEventAt ? toFriendlyDate(socketLastEventAt) : "none"}</DebugField>
        <DebugField label="Last snapshot">
          {socketLastSnapshotAt ? toFriendlyDate(socketLastSnapshotAt) : "none"}
        </DebugField>
        <DebugField label="Last error">{socketLastErrorAt ? toFriendlyDate(socketLastErrorAt) : "none"}</DebugField>
      </DebugFieldGrid>
      {socketLastEvent && (
        <div className="mt-2 rounded-md border border-[color:var(--ui-border-subtle)] bg-[color:var(--ui-bg-alt)] px-2 py-1.5 text-ui-2xs text-[color:var(--ui-ink-note)]">
          Last envelope: kind={socketLastEvent.kind} seq={socketLastEvent.seq} status={socketLastEvent.status} job=
          {socketLastEvent.jobId}
        </div>
      )}
    </DebugSection>
  );
}

