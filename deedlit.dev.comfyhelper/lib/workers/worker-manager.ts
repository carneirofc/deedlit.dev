import type {
  BackgroundService,
  ServiceContext,
  ServiceLogger,
  ServiceStatus,
  WorkerManagerHealth,
} from "./worker-types";
import {
  emitWorkerEvent,
  subscribeWorkerChannel,
  subscribeWorkerKind,
} from "@/lib/messaging/worker";

const MANAGER_CHANNEL = "worker-manager" as const;

type ManagedService = {
  service: BackgroundService;
  status: ServiceStatus;
  controller: AbortController | null;
  unsubscribers: Set<() => void>;
  startedAt: string | null;
  stoppedAt: string | null;
  error?: string;
};

type GlobalWorkerManager = {
  services: Map<string, ManagedService>;
  status: "idle" | "running" | "stopping" | "stopped";
  startedAt: string | null;
};

declare global {
  var __comfyhelperWorkerManager: GlobalWorkerManager | undefined;
}

function getManager(): GlobalWorkerManager {
  if (!globalThis.__comfyhelperWorkerManager) {
    globalThis.__comfyhelperWorkerManager = {
      services: new Map(),
      status: "idle",
      startedAt: null,
    };
  }
  return globalThis.__comfyhelperWorkerManager;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createServiceLogger(serviceName: string): ServiceLogger {
  const prefix = `[worker:${serviceName}]`;
  return {
    info: (msg, ...args) => console.log(prefix, msg, ...args),
    warn: (msg, ...args) => console.warn(prefix, msg, ...args),
    error: (msg, ...args) => console.error(prefix, msg, ...args),
    debug: (msg, ...args) => console.debug(prefix, msg, ...args),
  };
}

function trackUnsubscriber(
  managed: ManagedService,
  unsubscriber: () => void,
): () => void {
  let closed = false;
  const wrapped = () => {
    if (closed) {
      return;
    }
    closed = true;
    managed.unsubscribers.delete(wrapped);
    unsubscriber();
  };
  managed.unsubscribers.add(wrapped);
  return wrapped;
}

function cleanupSubscriptions(managed: ManagedService): void {
  for (const unsubscribe of [...managed.unsubscribers]) {
    try {
      unsubscribe();
    } catch {
      // best-effort cleanup
    }
  }
  managed.unsubscribers.clear();
}

function createServiceContext(
  serviceName: string,
  controller: AbortController,
  managed: ManagedService,
): ServiceContext {
  const logger = createServiceLogger(serviceName);

  const subscribe = (channel: string, listener: Parameters<ServiceContext["subscribe"]>[1]) => {
    return trackUnsubscriber(managed, subscribeWorkerChannel(channel, listener));
  };

  const subscribeKind = (
    channel: string,
    kind: string,
    listener: Parameters<ServiceContext["subscribeKind"]>[2],
  ) => {
    return trackUnsubscriber(managed, subscribeWorkerKind(channel, kind, listener));
  };

  return {
    emit: emitWorkerEvent,
    subscribe,
    subscribeKind,
    logger,
    signal: controller.signal,
  };
}

export function registerService(service: BackgroundService): void {
  const manager = getManager();

  if (manager.services.has(service.name)) {
    console.warn(`[worker-manager] service "${service.name}" is already registered`);
    return;
  }

  const managed: ManagedService = {
    service,
    status: "registered",
    controller: null,
    unsubscribers: new Set(),
    startedAt: null,
    stoppedAt: null,
  };

  manager.services.set(service.name, managed);
  emitWorkerEvent(MANAGER_CHANNEL, "service.registered", { name: service.name });
}

export function unregisterService(name: string): boolean {
  const manager = getManager();
  const managed = manager.services.get(name);
  if (!managed) {
    return false;
  }

  if (managed.status === "running" || managed.status === "starting") {
    console.warn(`[worker-manager] cannot unregister "${name}" while status=${managed.status}`);
    return false;
  }

  cleanupSubscriptions(managed);
  manager.services.delete(name);
  emitWorkerEvent(MANAGER_CHANNEL, "service.unregistered", { name });
  return true;
}

export async function startService(name: string): Promise<boolean> {
  const manager = getManager();
  const managed = manager.services.get(name);

  if (!managed) {
    console.error(`[worker-manager] service "${name}" is not registered`);
    return false;
  }

  if (managed.status === "running" || managed.status === "starting") {
    console.warn(`[worker-manager] service "${name}" is already ${managed.status}`);
    return false;
  }

  const controller = new AbortController();
  managed.controller = controller;
  managed.status = "starting";
  managed.error = undefined;

  const context = createServiceContext(name, controller, managed);

  try {
    emitWorkerEvent(MANAGER_CHANNEL, "service.starting", { name });
    await managed.service.start(context);

    managed.status = "running";
    managed.startedAt = nowIso();
    managed.stoppedAt = null;

    emitWorkerEvent(MANAGER_CHANNEL, "service.started", { name });
    return true;
  } catch (err) {
    managed.status = "error";
    managed.error = err instanceof Error ? err.message : String(err);

    controller.abort();
    cleanupSubscriptions(managed);
    managed.controller = null;

    emitWorkerEvent(MANAGER_CHANNEL, "service.error", { name, error: managed.error });
    console.error(`[worker-manager] failed to start "${name}"`, err);
    return false;
  }
}

export async function stopService(name: string): Promise<boolean> {
  const manager = getManager();
  const managed = manager.services.get(name);

  if (!managed) {
    console.error(`[worker-manager] service "${name}" is not registered`);
    return false;
  }

  if (managed.status !== "running" && managed.status !== "starting" && managed.status !== "error") {
    console.warn(`[worker-manager] service "${name}" is not running (status=${managed.status})`);
    return false;
  }

  managed.status = "stopping";
  emitWorkerEvent(MANAGER_CHANNEL, "service.stopping", { name });
  managed.controller?.abort();
  cleanupSubscriptions(managed);

  try {
    await managed.service.stop();
  } catch (err) {
    console.error(`[worker-manager] failed to stop "${name}"`, err);
  }

  managed.status = "stopped";
  managed.stoppedAt = nowIso();
  managed.controller = null;

  emitWorkerEvent(MANAGER_CHANNEL, "service.stopped", { name });
  return true;
}

export async function startAll(): Promise<void> {
  const manager = getManager();
  manager.status = "running";
  manager.startedAt = manager.startedAt ?? nowIso();

  emitWorkerEvent(MANAGER_CHANNEL, "manager.starting", {
    services: [...manager.services.keys()],
  });

  const startable = [...manager.services.entries()]
    .filter(([, m]) => m.status !== "running" && m.status !== "starting")
    .map(([name]) => name);

  for (const name of startable) {
    await startService(name);
  }

  emitWorkerEvent(MANAGER_CHANNEL, "manager.started", {
    services: [...manager.services.keys()],
  });
}

export async function stopAll(): Promise<void> {
  const manager = getManager();
  manager.status = "stopping";

  emitWorkerEvent(MANAGER_CHANNEL, "manager.stopping", {
    services: [...manager.services.keys()],
  });

  const stoppable = [...manager.services.entries()]
    .filter(([, m]) => m.status === "running" || m.status === "starting" || m.status === "error")
    .map(([name]) => name)
    .reverse();

  for (const name of stoppable) {
    await stopService(name);
  }

  manager.status = "stopped";

  emitWorkerEvent(MANAGER_CHANNEL, "manager.stopped", {
    services: [...manager.services.keys()],
  });
}

export function listServices(): string[] {
  return [...getManager().services.keys()];
}

export function getServiceHealth(name: string) {
  const managed = getManager().services.get(name);
  if (!managed) {
    return null;
  }

  try {
    return managed.service.health();
  } catch {
    return {
      name,
      status: managed.status,
      startedAt: managed.startedAt,
      stoppedAt: managed.stoppedAt,
      error: managed.error,
    };
  }
}

export function getWorkerManagerHealth(): WorkerManagerHealth {
  const manager = getManager();
  const services = [...manager.services.entries()].map(([name, managed]) => {
    try {
      return managed.service.health();
    } catch {
      return {
        name,
        status: managed.status,
        startedAt: managed.startedAt,
        stoppedAt: managed.stoppedAt,
        error: managed.error,
      };
    }
  });

  return {
    status: manager.status,
    startedAt: manager.startedAt,
    services,
  };
}
