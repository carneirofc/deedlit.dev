export async function register() {
  // Only bootstrap workers on the server (Node.js runtime), not during builds
  // or in the Edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapWorkers } = await import("@/lib/workers/bootstrap");
    await bootstrapWorkers();

    // Register a graceful shutdown handler so the SQLite connection is cleanly
    // closed (releasing WAL locks / journal files) when the process exits.
    const { disconnectDatabase } = await import("@/lib/db/client");
    const shutdown = () => {
      disconnectDatabase().catch(() => {});
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    process.once("beforeExit", shutdown);
  }
}
