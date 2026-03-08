import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { getLogger } from "../logger";
import { getStorageConfig } from "@/lib/storage-paths";

const storageConfig = getStorageConfig();
const DATA_DIRECTORY = storageConfig.dataDirectory;
const DATABASE_PATH = storageConfig.databasePath;
const DATABASE_BACKUP_PATH = storageConfig.databaseBackupPath;
const DATABASE_RELATIVE_PATH = storageConfig.databaseDisplayPath;
const PRISMA_CONFIG_RELATIVE_PATH = "prisma.config.ts";
const logger = getLogger({ scope: "prisma" });

mkdirSync(DATA_DIRECTORY, { recursive: true });

// ---------------------------------------------------------------------------
// Globals — keyed with __comfyhelper prefix to survive Next.js HMR remounts.
// Both development (module re-evaluation on HMR) and production (multiple
// imports of the same module in the same process) need the singleton stored
// on globalThis so only one SQLite file handle ever exists per process.
// ---------------------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __comfyhelperPrismaClient: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __comfyhelperDbInitialized: boolean | undefined;
  // eslint-disable-next-line no-var
  var __comfyhelperDbInitializationPromise: Promise<void> | undefined;
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({
    url: `file:${DATABASE_PATH}`,
    // Spin-wait up to 10 s before throwing SQLITE_BUSY.
    // This allows concurrent route handlers and the background scan worker
    // to queue writes instead of immediately crashing with a busy error.
    timeout: 10_000,
    // WAL mode is set via pragma once the connection is open (see enableWal).
  });
  const client = new PrismaClient({ adapter });

  // Enable WAL journal mode and set synchronous=NORMAL for this connection.
  // WAL allows concurrent readers while a write is in progress, eliminating
  // most SQLITE_BUSY scenarios between route handlers and background workers.
  // We use $executeRawUnsafe via a one-shot lazy pragma on first DB access.
  enableWalOnConnect(client);

  return client;
}

function getOrCreatePrismaClient(): PrismaClient {
  if (!globalThis.__comfyhelperPrismaClient) {
    globalThis.__comfyhelperPrismaClient = createPrismaClient();
  }

  return globalThis.__comfyhelperPrismaClient;
}

/**
 * Fire-and-forget WAL bootstrap.  We can't await inside the module (top-level
 * await is not available here) so we queue it as a microtask.  The pragmas are
 * idempotent and safe to run repeatedly — in practice they only run once since
 * the client is a singleton.
 */
function enableWalOnConnect(client: PrismaClient): void {
  Promise.resolve()
    .then(async () => {
      try {
        // Journaling & durability
        await client.$executeRawUnsafe("PRAGMA journal_mode = WAL");
        // NORMAL is safe with WAL and much faster than FULL
        await client.$executeRawUnsafe("PRAGMA synchronous = NORMAL");
        // Enforce FK constraints
        await client.$executeRawUnsafe("PRAGMA foreign_keys = ON");

        // Performance optimizations
        // 64 MB in-memory page cache (negative value = kibibytes)
        await client.$executeRawUnsafe("PRAGMA cache_size = -65536");
        // Keep temp tables and indices in memory
        await client.$executeRawUnsafe("PRAGMA temp_store = MEMORY");
        // 256 MB memory-mapped I/O — reduces syscall overhead on large reads
        await client.$executeRawUnsafe("PRAGMA mmap_size = 268435456");
        // Coalesce small writes into a single fsync (safe with WAL)
        await client.$executeRawUnsafe("PRAGMA wal_autocheckpoint = 1000");
      } catch (err) {
        // Non-fatal — the database will still work, just without the optimizations.
        logger.warn({ err }, "Failed to set SQLite pragmas");
      }
    })
    .catch(() => {
      // swallow — logged above
    });
}

// Singleton: expose a stable PrismaClient-shaped proxy while instantiating the
// actual SQLite connection lazily, so startup migrations can run before any
// client opens the database file.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getOrCreatePrismaClient() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(getOrCreatePrismaClient()) : value;
  },
}) as PrismaClient;

/** @deprecated Use `prisma` directly instead. Kept for migration compatibility. */
export const db = prisma;

export function getDatabasePathInfo() {
  return {
    absolutePath: DATABASE_PATH,
    relativePath: DATABASE_RELATIVE_PATH,
    baseDirectory: storageConfig.baseDirectory,
    profile: storageConfig.profile,
  };
}

/**
 * Gracefully disconnect the Prisma client and release the SQLite file handle.
 * Call this during process shutdown (e.g. SIGTERM handlers) to avoid leaving
 * stale WAL-mode locks or journal files behind.
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await globalThis.__comfyhelperPrismaClient?.$disconnect();
  } catch {
    // best-effort
  } finally {
    globalThis.__comfyhelperPrismaClient = undefined;
  }
}

async function runDatabaseMigration(): Promise<void> {
  const dbExists = existsSync(DATABASE_PATH);
  if (dbExists) {
    try {
      copyFileSync(DATABASE_PATH, DATABASE_BACKUP_PATH);
      logger.info({ backupPath: DATABASE_BACKUP_PATH }, "Database backup created");
    } catch (backupErr) {
      logger.warn({ err: backupErr }, "Could not create pre-migration backup");
    }
  }

  try {
    execSync(`npx prisma migrate deploy --config ${PRISMA_CONFIG_RELATIVE_PATH}`, {
      cwd: process.cwd(),
      stdio: "pipe",
      env: {
        ...process.env,
        DATABASE_URL: `file:${DATABASE_PATH}`,
      },
    });

    if (dbExists) {
      try {
        rmSync(DATABASE_BACKUP_PATH, { force: true });
      } catch {
        // Non-fatal: leave the backup in place if we can't delete it.
      }
    }
  } catch (error) {
    if (dbExists && existsSync(DATABASE_BACKUP_PATH)) {
      try {
        renameSync(DATABASE_BACKUP_PATH, DATABASE_PATH);
        logger.error("Migration failed; database restored from backup");
      } catch (restoreErr) {
        logger.error(
          { err: restoreErr, backupPath: DATABASE_BACKUP_PATH },
          "Migration failed and restore failed; manual recovery may be needed",
        );
      }
    }

    throw error;
  }
}

/**
 * Ensure the database schema is up to date by running Prisma migrations.
 * Safe to call multiple times — only runs once per process.  The `hasInitialized`
 * flag is stored on globalThis so it survives Next.js HMR module re-evaluation.
 */
export async function ensureDatabase(): Promise<void> {
  if (globalThis.__comfyhelperDbInitialized) {
    return;
  }

  if (globalThis.__comfyhelperDbInitializationPromise) {
    await globalThis.__comfyhelperDbInitializationPromise;
    return;
  }

  globalThis.__comfyhelperDbInitializationPromise = (async () => {
    await disconnectDatabase();
    await runDatabaseMigration();
    globalThis.__comfyhelperDbInitialized = true;
  })();

  try {
    await globalThis.__comfyhelperDbInitializationPromise;
  } catch (error) {
    globalThis.__comfyhelperDbInitialized = false;
    throw new Error(
      `[prisma] migrate deploy failed during startup: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    globalThis.__comfyhelperDbInitializationPromise = undefined;
  }
}
