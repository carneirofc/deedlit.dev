// Next.js instrumentation hook. Runs once per server process at startup.
// Registers OpenTelemetry tracing via @vercel/otel, which auto-instruments
// HTTP/fetch and exports spans over OTLP to the endpoint named by
// OTEL_EXPORTER_OTLP_ENDPOINT (Alloy -> Tempo in docker-compose).
//
// When that env var is unset (e.g. plain `npm run dev`), no exporter is wired
// up and tracing is a no-op, so this is safe to leave registered everywhere.
import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "comfyhelper",
  });
}
