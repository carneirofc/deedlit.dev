import { ZodError } from "zod";

import {
  RemoveRootResponseSchema,
  RootVisibilityPatchBodySchema,
  RouteIdSchema,
  UpdateRootVisibilityResponseSchema,
} from "@/lib/contracts/api";
import { errorJson, jsonWithSchema, zodErrorMessage } from "@/lib/http/route-response";
import { ConfigStoreError, removeRoot, setRootVisibility } from "@/lib/config-store";
import { invalidatePromptStatisticsCache } from "@/lib/prompt-statistics-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = RouteIdSchema.parse(await context.params);
    await removeRoot(id);
    invalidatePromptStatisticsCache();
    return jsonWithSchema(RemoveRootResponseSchema, { ok: true });
  } catch (error) {
    if (error instanceof ConfigStoreError) {
      return errorJson(error.message, error.status);
    }
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid root id."), 400);
    }

    return errorJson("Failed to remove root directory.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = RouteIdSchema.parse(await context.params);
    const body = RootVisibilityPatchBodySchema.parse(await request.json());
    const root = await setRootVisibility(id, body.isVisible);
    invalidatePromptStatisticsCache();
    return jsonWithSchema(UpdateRootVisibilityResponseSchema, { root });
  } catch (error) {
    if (error instanceof ConfigStoreError) {
      return errorJson(error.message, error.status);
    }
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid request."), 400);
    }

    return errorJson("Failed to update root visibility.", 500);
  }
}
