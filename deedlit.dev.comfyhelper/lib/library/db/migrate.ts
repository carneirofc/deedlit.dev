import { readFile } from "node:fs/promises";
import path from "node:path";

import { getLogger } from "@/lib/logger";
import { withTransaction } from "@/lib/library/db/postgres";

const logger = getLogger({ scope: "library-migrate" });

declare global {
  var __comfyhelperLibrarySchemaReady: boolean | undefined;
  var __comfyhelperLibrarySchemaPromise: Promise<void> | undefined;
}

const SCHEMA_PATH = path.join(process.cwd(), "lib", "library", "db", "schema.sql");

/**
 * Application-defined key for the PostgreSQL advisory lock that serializes
 * schema application across connections *and* processes.  Two cold starts that
 * both run the idempotent DDL at the same time would otherwise take conflicting
 * AccessExclusiveLocks (CREATE INDEX / ALTER TABLE / CREATE TABLE) and deadlock
 * (Postgres error 40P01).  Any stable bigint works; this one is arbitrary.
 */
const SCHEMA_ADVISORY_LOCK_KEY = 8273461982734;

/**
 * Apply the canonical schema.  The DDL is fully idempotent (IF NOT EXISTS
 * everywhere) so this can run on every cold start; we still guard with a
 * process-level flag to avoid re-reading the file on each request.
 *
 * Concurrency is handled at two levels:
 *  - an in-process promise collapses simultaneous callers onto one execution;
 *  - a transaction-scoped advisory lock serializes execution across every
 *    connection and process, so concurrent DDL never deadlocks.
 */
export async function ensureLibrarySchema(): Promise<void> {
  if (globalThis.__comfyhelperLibrarySchemaReady) {
    return;
  }
  // Collapse concurrent callers in this process onto a single execution so the
  // route handlers that all call this on mount don't each run the DDL.
  if (!globalThis.__comfyhelperLibrarySchemaPromise) {
    globalThis.__comfyhelperLibrarySchemaPromise = applySchema();
  }
  try {
    await globalThis.__comfyhelperLibrarySchemaPromise;
    globalThis.__comfyhelperLibrarySchemaReady = true;
  } finally {
    // Clear on both success and failure: on failure the next request retries
    // (e.g. the database came up after the app booted).
    globalThis.__comfyhelperLibrarySchemaPromise = undefined;
  }
}

async function applySchema(): Promise<void> {
  const sql = await readFile(SCHEMA_PATH, "utf8");
  await withTransaction(async (client) => {
    // Hold a transaction-scoped advisory lock for the whole DDL run so any other
    // cold start blocks here instead of racing us into a deadlock.  DDL in
    // PostgreSQL is transactional, so the schema is applied atomically.
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [SCHEMA_ADVISORY_LOCK_KEY]);
    await client.query(sql);
  });
  logger.info("Library PostgreSQL schema ensured");
}
