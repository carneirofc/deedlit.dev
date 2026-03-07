import { registerService, startAll, getWorkerManagerHealth } from "@/lib/workers";
import { FileWatcherService, ScanCoordinatorService, StatsWorkerService } from "@/lib/workers/services";

declare global {
  var __comfyhelperWorkersBootstrapped: boolean | undefined;
}

const WORKER_DEFAULTS = {
  fileWatcherPollIntervalMs: 30_000,
  scanDebounceMs: 5_000,
  scanCooldownMs: 15_000,
} as const;

function registerDefaultServices(): void {
  registerService(
    new FileWatcherService({
      pollIntervalMs: WORKER_DEFAULTS.fileWatcherPollIntervalMs,
    }),
  );
  registerService(
    new ScanCoordinatorService({
      debounceMs: WORKER_DEFAULTS.scanDebounceMs,
      cooldownMs: WORKER_DEFAULTS.scanCooldownMs,
    }),
  );
  registerService(new StatsWorkerService());
}

export async function bootstrapWorkers() {
  if (globalThis.__comfyhelperWorkersBootstrapped) {
    return getWorkerManagerHealth();
  }
  globalThis.__comfyhelperWorkersBootstrapped = true;

  registerDefaultServices();
  await startAll();
  return getWorkerManagerHealth();
}
