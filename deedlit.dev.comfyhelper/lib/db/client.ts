import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/lib/generated/prisma/client";

const DATA_DIRECTORY = path.join(process.cwd(), "data");
const DATABASE_PATH = path.join(DATA_DIRECTORY, "comfyhelper.db");
const DATABASE_BACKUP_PATH = path.join(DATA_DIRECTORY, "comfyhelper.db.migrate-backup");
const DATABASE_RELATIVE_PATH = path.join("data", "comfyhelper.db");

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
        console.warn("[prisma] failed to set SQLite pragmas:", err instanceof Error ? err.message : err);
      }
    })
    .catch(() => {
      // swallow — logged above
    });
}

// Singleton: reuse across HMR cycles (dev) and within the same process (prod).
export const prisma: PrismaClient =
  globalThis.__comfyhelperPrismaClient ?? createPrismaClient();

// Always persist so the next module evaluation reuses the same handle.
globalThis.__comfyhelperPrismaClient = prisma;

/** @deprecated Use `prisma` directly instead. Kept for migration compatibility. */
export const db = prisma;

export function getDatabasePathInfo() {
  return {
    absolutePath: DATABASE_PATH,
    relativePath: DATABASE_RELATIVE_PATH,
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

/**
 * Ensure the database schema is up to date by running Prisma migrations.
 * Safe to call multiple times — only runs once per process.  The `hasInitialized`
 * flag is stored on globalThis so it survives Next.js HMR module re-evaluation.
 */
export async function ensureDatabase(): Promise<void> {
  if (globalThis.__comfyhelperDbInitialized) {
    return;
  }

  // Mark eagerly to prevent concurrent callers (e.g. parallel route handlers
  // during startup) from spawning multiple migration processes at once.
  globalThis.__comfyhelperDbInitialized = true;

  // ------------------------------------------------------------------
  // Backup before migrating so we can roll back on failure.
  // ------------------------------------------------------------------
  const dbExists = existsSync(DATABASE_PATH);
  if (dbExists) {
    try {
      copyFileSync(DATABASE_PATH, DATABASE_BACKUP_PATH);
      console.info("[prisma] database backup created:", DATABASE_BACKUP_PATH);
    } catch (backupErr) {
      console.warn(
        "[prisma] could not create pre-migration backup (proceeding anyway):",
        backupErr instanceof Error ? backupErr.message : backupErr,
      );
    }
  }

  try {
    // Run pending migrations programmatically
    execSync("npx prisma migrate deploy", {
      cwd: process.cwd(),
      stdio: "pipe",
      env: {
        ...process.env,
        DATABASE_URL: `file:${DATABASE_PATH}`,
      },
    });

    // Migration succeeded — remove the backup to keep the data directory clean.
    if (dbExists) {
      try {
        rmSync(DATABASE_BACKUP_PATH, { force: true });
      } catch {
        // Non-fatal: leave the backup in place if we can't delete it.
      }
    }
  } catch (error) {
    // ------------------------------------------------------------------
    // Restore the pre-migration backup so the app can still start with
    // the last known-good schema.
    // ------------------------------------------------------------------
    if (dbExists && existsSync(DATABASE_BACKUP_PATH)) {
      try {
        renameSync(DATABASE_BACKUP_PATH, DATABASE_PATH);
        console.error("[prisma] migration failed — database restored from backup.");
      } catch (restoreErr) {
        console.error(
          "[prisma] migration failed AND restore failed — manual recovery may be needed.",
          "Backup is at:", DATABASE_BACKUP_PATH,
          restoreErr instanceof Error ? restoreErr.message : restoreErr,
        );
      }
    }

    console.warn(
      "[prisma] migrate deploy failed (database may already be up to date):",
      error instanceof Error ? error.message : error,
    );
  }
}
