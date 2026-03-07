import {
  type ReplayableEventsStreamMessage,
  type ScanProgressPayload,
  ScanCompletedMessageSchema,
  ScanFailedMessageSchema,
  ScanQueuedMessageSchema,
  ScanRunningMessageSchema,
  ScanSnapshotMessageSchema,
} from "@/lib/contracts/realtime";
import type { ScanJobInfo, ScanJobStatus } from "@/lib/library-types";
import { createReplayableChannel } from "@/lib/messaging/replayable-channel";

const BUS_NAME = "comfyhelper-public-events";
const HISTORY_LIMIT = 2_000;
const CHANNEL = "scan" as const;

const REPLAYABLE_TYPES = ["scan.queued", "scan.running", "scan.completed", "scan.failed"] as const;

const STATUS_TO_TYPE: Record<ScanJobStatus, (typeof REPLAYABLE_TYPES)[number]> = {
  queued: "scan.queued",
  running: "scan.running",
  completed: "scan.completed",
  failed: "scan.failed",
};

const scanChannel = createReplayableChannel({
  busName: BUS_NAME,
  historyLimit: HISTORY_LIMIT,
  channel: CHANNEL,
  types: REPLAYABLE_TYPES,
  payloadSchemas: {
    "scan.queued": ScanQueuedMessageSchema.shape.payload,
    "scan.running": ScanRunningMessageSchema.shape.payload,
    "scan.completed": ScanCompletedMessageSchema.shape.payload,
    "scan.failed": ScanFailedMessageSchema.shape.payload,
  },
});

type ReplayableScanMessage = Extract<
  ReplayableEventsStreamMessage,
  { channel: "scan"; type: (typeof REPLAYABLE_TYPES)[number] }
>;

export function emitScanEvent(payload: Omit<ScanProgressPayload, "at">): ReplayableScanMessage {
  return scanChannel.emit(STATUS_TO_TYPE[payload.status], payload);
}

export function listScanEventsAfter(
  lastEventId: string | null | undefined,
  max = 250,
): ReplayableScanMessage[] {
  return scanChannel.listAfter(lastEventId, max);
}

export function subscribeScanEvents(
  listener: (event: ReplayableScanMessage) => void,
): () => void {
  return scanChannel.subscribe(listener);
}

export function createScanSnapshotMessage(payload: {
  scan: ScanJobInfo | null;
  replayFrom?: string | null;
}) {
  return ScanSnapshotMessageSchema.parse({
    schemaVersion: 2,
    channel: CHANNEL,
    type: "scan.snapshot",
    at: new Date().toISOString(),
    payload: {
      scan: payload.scan,
      replayFrom: payload.replayFrom ?? null,
    },
  });
}

export function getScanEventHealth() {
  return scanChannel.getHealth();
}
