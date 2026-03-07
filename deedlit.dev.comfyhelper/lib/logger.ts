import pino, { type Logger } from "pino";

type LoggerBindings = Record<string, unknown>;

declare global {
  var __comfyhelperLogger: Logger | undefined;
}

function createBaseLogger(): Logger {
  const isPrettyEnabled = process.env.NODE_ENV !== "production";

  return pino({
    name: "comfyhelper",
    level: process.env.LOG_LEVEL ?? (isPrettyEnabled ? "debug" : "info"),
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
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