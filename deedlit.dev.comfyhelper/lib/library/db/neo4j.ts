import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import neo4j, { type Driver, type Session, type QueryResult } from "neo4j-driver";

import { getLogger } from "@/lib/logger";
import { getLibraryConfig } from "@/lib/library/config";

const logger = getLogger({ scope: "library-neo4j" });

// Neo4j speaks the binary Bolt protocol over a raw TCP socket, so there is no
// off-the-shelf OpenTelemetry auto-instrumentation for it (unlike pg/aws-sdk).
// We emit one client span per Cypher statement by hand instead. All Neo4j
// access flows through runCypher(), so this single wrapper covers every query.
const tracer = trace.getTracer("library-neo4j");

/** First Cypher keyword (MATCH/MERGE/CREATE/...) for a readable span name. */
function cypherOperation(cypher: string): string {
  return cypher.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? "CYPHER";
}

declare global {
  var __comfyhelperNeo4jDriver: Driver | undefined;
}

/**
 * Shared Neo4j driver.  Neo4j is a rebuildable projection of the canonical
 * PostgreSQL data — it explains relationships (tags, models, LoRAs, lineage).
 */
export function getDriver(): Driver {
  if (!globalThis.__comfyhelperNeo4jDriver) {
    const { neo4j: cfg } = getLibraryConfig();
    globalThis.__comfyhelperNeo4jDriver = neo4j.driver(
      cfg.uri,
      neo4j.auth.basic(cfg.user, cfg.password),
      { maxConnectionPoolSize: 20, disableLosslessIntegers: true },
    );
  }
  return globalThis.__comfyhelperNeo4jDriver;
}

/** Run a Cypher statement in an auto-commit session and return the result. */
export async function runCypher(
  cypher: string,
  params: Record<string, unknown> = {},
  mode: "READ" | "WRITE" = "WRITE",
): Promise<QueryResult> {
  const operation = cypherOperation(cypher);
  return tracer.startActiveSpan(
    `neo4j.${operation}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "db.system": "neo4j",
        "db.operation": operation,
        "db.statement": cypher,
        "db.neo4j.access_mode": mode,
      },
    },
    async (span) => {
      const session: Session = getDriver().session({
        defaultAccessMode: mode === "READ" ? neo4j.session.READ : neo4j.session.WRITE,
      });
      try {
        const result = await session.run(cypher, params);
        span.setAttribute("db.neo4j.records_returned", result.records.length);
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        throw error;
      } finally {
        await session.close();
        span.end();
      }
    },
  );
}

export async function pingNeo4j(): Promise<boolean> {
  try {
    await getDriver().verifyConnectivity();
    return true;
  } catch (error) {
    logger.warn({ err: error }, "Neo4j ping failed");
    return false;
  }
}

export async function closeDriver(): Promise<void> {
  await globalThis.__comfyhelperNeo4jDriver?.close().catch(() => {});
  globalThis.__comfyhelperNeo4jDriver = undefined;
}
