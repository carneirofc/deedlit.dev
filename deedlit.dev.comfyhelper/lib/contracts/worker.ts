import { z } from "zod";

export const FileFingerprintSchema = z.object({
  absolutePath: z.string().min(1),
  relativePath: z.string().min(1),
  rootId: z.string().min(1),
  size: z.int().nonnegative(),
  modifiedAtMs: z.int().nonnegative(),
});

export const FileChangeSetSchema = z.object({
  added: z.array(FileFingerprintSchema),
  modified: z.array(FileFingerprintSchema),
  removed: z.array(FileFingerprintSchema),
  rootIds: z.array(z.string().min(1)),
  totalKnown: z.int().nonnegative(),
  pollDurationMs: z.int().nonnegative(),
});

const ServiceNamePayloadSchema = z.object({
  name: z.string().min(1),
});

const ServiceErrorPayloadSchema = ServiceNamePayloadSchema.extend({
  error: z.string().min(1),
});

const ManagerServicesPayloadSchema = z.object({
  services: z.array(z.string().min(1)),
});

const FileWatcherStartedPayloadSchema = z.object({
  pollIntervalMs: z.int().positive(),
  knownFiles: z.int().nonnegative(),
});

const FileWatcherErrorPayloadSchema = z.object({
  error: z.string().min(1),
});

const ScanCoordinatorStartedPayloadSchema = z.object({
  debounceMs: z.int().positive(),
  cooldownMs: z.int().nonnegative(),
});

const ScanCoordinatorTriggeredPayloadSchema = z.object({
  jobId: z.string().min(1),
});

const ScanCoordinatorTriggeringPayloadSchema = z.object({
  added: z.int().nonnegative(),
  modified: z.int().nonnegative(),
  removed: z.int().nonnegative(),
  pendingBatches: z.int().nonnegative(),
});

const ScanCoordinatorSkippedPayloadSchema = z.union([
  z.object({
    reason: z.literal("cooldown"),
  }),
  z.object({
    reason: z.literal("already-running"),
    jobId: z.string().min(1),
    jobStatus: z.string().min(1),
  }),
]);

const ScanCoordinatorErrorPayloadSchema = z.object({
  error: z.string().min(1),
});

export const WorkerEventPayloadSchemas = {
  "worker-manager": {
    "service.registered": ServiceNamePayloadSchema,
    "service.unregistered": ServiceNamePayloadSchema,
    "service.starting": ServiceNamePayloadSchema,
    "service.started": ServiceNamePayloadSchema,
    "service.error": ServiceErrorPayloadSchema,
    "service.stopping": ServiceNamePayloadSchema,
    "service.stopped": ServiceNamePayloadSchema,
    "manager.starting": ManagerServicesPayloadSchema,
    "manager.started": ManagerServicesPayloadSchema,
    "manager.stopping": ManagerServicesPayloadSchema,
    "manager.stopped": ManagerServicesPayloadSchema,
  },
  "file-watcher": {
    "watcher.started": FileWatcherStartedPayloadSchema,
    "files.changed": FileChangeSetSchema,
    "watcher.error": FileWatcherErrorPayloadSchema,
  },
  "scan-coordinator": {
    "coordinator.started": ScanCoordinatorStartedPayloadSchema,
    "scan.triggering": ScanCoordinatorTriggeringPayloadSchema,
    "scan.triggered": ScanCoordinatorTriggeredPayloadSchema,
    "scan.skipped": ScanCoordinatorSkippedPayloadSchema,
    "coordinator.error": ScanCoordinatorErrorPayloadSchema,
  },
} as const;

export type FileFingerprint = z.infer<typeof FileFingerprintSchema>;
export type FileChangeSet = z.infer<typeof FileChangeSetSchema>;

