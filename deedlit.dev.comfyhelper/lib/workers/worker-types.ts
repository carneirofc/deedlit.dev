// ---------------------------------------------------------------------------
// Background worker types — contracts for modular background services
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/** A general-purpose event emitted or received by background services. */
export type WorkerEvent<TPayload = unknown> = {
  /** Schema version for forward-compatible evolution. */
  schemaVersion: number;
  /** Globally unique event id (stringified seq). */
  id: string;
  /** Monotonically increasing sequence number. */
  seq: number;
  /** Logical channel the event belongs to (e.g. "library-scan", "thumbnails"). */
  channel: string;
  /** Dot-delimited event kind within the channel (e.g. "scan.completed"). */
  kind: string;
  /** ISO-8601 timestamp. */
  at: string;
  /** Arbitrary payload — typed by the individual service. */
  payload: TPayload;
};

export type WorkerEventListener<TPayload = unknown> = (event: WorkerEvent<TPayload>) => void;

// ---------------------------------------------------------------------------
// Service context — injected into each service at start()
// ---------------------------------------------------------------------------

export type ServiceLogger = {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
};

/**
 * Context handed to every `BackgroundService.start()` call.
 * Provides event-bus access, a scoped logger, and an `AbortSignal` the
 * service should respect for graceful shutdown.
 */
export type ServiceContext = {
  /** Emit an event on a named channel. */
  emit: (channel: string, kind: string, payload: unknown) => void;
  /** Subscribe to all events on a channel. Returns an unsubscribe function. */
  subscribe: (channel: string, listener: WorkerEventListener) => () => void;
  /** Subscribe to events matching a specific kind. Returns an unsubscribe function. */
  subscribeKind: (channel: string, kind: string, listener: WorkerEventListener) => () => void;
  /** Pre-configured logger scoped to the service name. */
  logger: ServiceLogger;
  /** Signal that fires when the service is asked to stop. */
  signal: AbortSignal;
};

// ---------------------------------------------------------------------------
// Service health
// ---------------------------------------------------------------------------

export type ServiceStatus = "registered" | "starting" | "running" | "stopping" | "stopped" | "error";

export type ServiceHealth = {
  name: string;
  status: ServiceStatus;
  startedAt: string | null;
  stoppedAt: string | null;
  error?: string;
  /** Service-specific details (uptime counters, queue sizes, etc.). */
  details?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Background service interface
// ---------------------------------------------------------------------------

/**
 * Contract every background service must implement.
 *
 * Lifecycle:
 *   1. Service is registered with the WorkerManager.
 *   2. `start(ctx)` is called — the service sets up its work.
 *   3. `stop()` is called — the service tears down and releases resources.
 *   4. `health()` can be called at any time for diagnostics.
 */
export interface BackgroundService {
  /** Unique service name (used for logging, health endpoints, etc.). */
  readonly name: string;

  /**
   * Start the service. The provided `ServiceContext` grants access to the
   * event bus, a scoped logger, and an `AbortSignal` for shutdown.
   * Implementations should store the context and use it throughout operation.
   */
  start(context: ServiceContext): Promise<void>;

  /** Gracefully stop the service and release all resources. */
  stop(): Promise<void>;

  /** Return current health / diagnostic info. */
  health(): ServiceHealth;
}

// ---------------------------------------------------------------------------
// Manager health
// ---------------------------------------------------------------------------

export type WorkerManagerHealth = {
  status: "idle" | "running" | "stopping" | "stopped";
  startedAt: string | null;
  services: ServiceHealth[];
};
