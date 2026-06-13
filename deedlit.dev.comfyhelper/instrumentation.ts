// Next.js instrumentation hook. Runs once per server process at startup.
// Registers OpenTelemetry tracing via @vercel/otel, which auto-instruments
// HTTP/fetch and exports spans over OTLP to the endpoint named by
// OTEL_EXPORTER_OTLP_ENDPOINT (Alloy -> Tempo in docker-compose).
//
// When that env var is unset (e.g. plain `npm run dev`), no exporter is wired
// up and tracing is a no-op, so this is safe to leave registered everywhere.
//
// DB-level coverage:
//   - PostgreSQL (pg)         -> @opentelemetry/instrumentation-pg (auto)
//   - S3 / RustFS (aws-sdk)   -> @opentelemetry/instrumentation-aws-sdk (auto)
//   - Qdrant (REST over fetch)-> @vercel/otel's built-in "fetch" instrumentation
//   - Neo4j (Bolt protocol)   -> manual spans in lib/library/db/neo4j.ts
//     (Bolt is a binary TCP protocol with no off-the-shelf OTel instrumentation)
//
// pg and @aws-sdk/client-s3 are listed in serverExternalPackages (next.config.ts),
// so Next does NOT bundle them — they load via native require, which is what lets
// OpenTelemetry's require-hook patch them. Keep them external for tracing to work.
export async function register() {
  // Guard to the Node.js runtime; the OTel auto-instrumentations use Node-only
  // module hooks and must not run on the Edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const [{ registerOTel }, { PgInstrumentation }, { AwsInstrumentation }] = await Promise.all([
    import("@vercel/otel"),
    import("@opentelemetry/instrumentation-pg"),
    import("@opentelemetry/instrumentation-aws-sdk"),
  ]);

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "comfyhelper",
    instrumentations: [
      // Keep the default fetch instrumentation (covers Qdrant's REST client).
      "fetch",
      new PgInstrumentation({
        // Record the SQL text so slow queries are identifiable in Tempo.
        // Parameter values are NOT captured.
        enhancedDatabaseReporting: true,
      }),
      new AwsInstrumentation({ suppressInternalInstrumentation: true }),
    ],
  });
}
