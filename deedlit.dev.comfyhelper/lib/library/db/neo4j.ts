import neo4j, { type Driver, type Session, type QueryResult } from "neo4j-driver";

import { getLogger } from "@/lib/logger";
import { getLibraryConfig } from "@/lib/library/config";

const logger = getLogger({ scope: "library-neo4j" });

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
  const session: Session = getDriver().session({
    defaultAccessMode: mode === "READ" ? neo4j.session.READ : neo4j.session.WRITE,
  });
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
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
