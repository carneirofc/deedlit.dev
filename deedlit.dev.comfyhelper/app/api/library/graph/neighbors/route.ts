import { z } from "zod";

import { handleRoute, jsonOk } from "@/lib/library/http";
import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { GraphScopeSchema } from "@/lib/library/schemas";
import { resolveGraphScope } from "@/lib/library/services/graph-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  graphScope: GraphScopeSchema,
  limit: z.number().int().min(1).max(5000).default(1000),
});

/** Resolve a graph scope to the image ids it permits (count preview + scoping). */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = BodySchema.parse(await request.json());
    await ensureLibrarySchema();
    const ids = (await resolveGraphScope(body.graphScope, body.limit)) ?? [];
    return jsonOk({ ids, count: ids.length });
  });
}
