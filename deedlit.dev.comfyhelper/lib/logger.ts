import { context, trace } from "@opentelemetry/api";
import pino, { type Logger } from "pino";

type LoggerBindings = Record<string, unknown>;

declare global {
  var __comfyhelperLogger: Logger | undefined;
}

// Stamp every log line emitted inside an active span with its trace/span ids so
// Grafana can pivot from a log to its trace (and back). Returns nothing when no
// span is active or OpenTelemetry was never registered, so it is always safe.
function otelTraceContext(): Record<string, string> {
  const span = trace.getSpan(context.active());
  if (!span) {
    return {};
  }

  const { traceId, spanId, traceFlags } = span.spanContext();
  if (!traceId) {
    return {};
  }

  return { trace_id: traceId, span_id: spanId, trace_flags: traceFlags.toString(16) };
}

function createBaseLogger(): Logger {
  const isPrettyEnabled = process.env.NODE_ENV !== "production";

  return pino({
    name: "comfyhelper",
    level: process.env.LOG_LEVEL ?? (isPrettyEnabled ? "debug" : "info"),
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin: otelTraceContext,
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(isPrettyEnabled
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
            },
          },
        }
      : {}),
  });
}

export const logger = globalThis.__comfyhelperLogger ?? createBaseLogger();

if (!globalThis.__comfyhelperLogger) {
  globalThis.__comfyhelperLogger = logger;
}

export function getLogger(bindings?: LoggerBindings): Logger {
  if (!bindings) {
    return logger;
  }

  return logger.child(bindings);
}