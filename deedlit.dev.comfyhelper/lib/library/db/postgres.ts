import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { getLogger } from "@/lib/logger";
import { getLibraryConfig } from "@/lib/library/config";

const logger = getLogger({ scope: "library-postgres" });

declare global {
  var __comfyhelperPgPool: Pool | undefined;
}

/**
 * Shared PostgreSQL connection pool.  PostgreSQL is the canonical source of
 * truth for all canonical image metadata; Neo4j and Qdrant are derived from it.
 */
export function getPool(): Pool {
  if (!globalThis.__comfyhelperPgPool) {
    const { databaseUrl } = getLibraryConfig();
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (err) => {
      logger.error({ err }, "Idle PostgreSQL client error");
    });
    globalThis.__comfyhelperPgPool = pool;
  }
  return globalThis.__comfyhelperPgPool;
}

/** Run a parameterised query. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[]);
}

/** Convenience: return only the rows. */
export async function rows<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

/** Convenience: return the first row, or null. */
export async function maybeRow<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

/** Run a function inside a transaction with automatic commit/rollback. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Cheap connectivity probe for health checks. */
export async function pingPostgres(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch (error) {
    logger.warn({ err: error }, "PostgreSQL ping failed");
    return false;
  }
}

export async function closePool(): Promise<void> {
  await globalThis.__comfyhelperPgPool?.end().catch(() => {});
  globalThis.__comfyhelperPgPool = undefined;
}
