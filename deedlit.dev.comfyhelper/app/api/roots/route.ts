import { ZodError } from "zod";

import { AddRootBodySchema, AddRootResponseSchema, RootsListResponseSchema } from "@/lib/contracts/api";
import { errorJson, jsonWithSchema, zodErrorMessage } from "@/lib/http/route-response";
import { addRoot, ConfigStoreError, listRoots } from "@/lib/config-store";
import { invalidatePromptStatisticsCache } from "@/lib/prompt-statistics-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const roots = await listRoots();
  return jsonWithSchema(RootsListResponseSchema, { roots });
}

export async function POST(request: Request) {
  try {
    const body = AddRootBodySchema.parse(await request.json());
    const root = await addRoot(body.path);
    invalidatePromptStatisticsCache();
    return jsonWithSchema(AddRootResponseSchema, { root }, { status: 201 });
  } catch (error) {
    if (error instanceof ConfigStoreError) {
      return errorJson(error.message, error.status);
    }
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid request body."), 400);
    }

    return errorJson("Failed to add root directory.", 500);
  }
}
