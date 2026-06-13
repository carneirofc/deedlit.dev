import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getLogger } from "@/lib/logger";

const logger = getLogger({ scope: "library-http" });

export function jsonOk(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Wrap a route handler with consistent Zod / unexpected-error handling. */
export async function handleRoute(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(error.issues[0]?.message ?? "Invalid request.", 400);
    }
    logger.error({ err: error }, "library route failed");
    const message = error instanceof Error ? error.message : "Internal error.";
    return jsonError(message, 500);
  }
}
