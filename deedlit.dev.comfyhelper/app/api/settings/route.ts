import { ZodError } from "zod";

import { SettingsPatchSchema, SettingsResponseSchema } from "@/lib/contracts/api";
import { errorJson, jsonWithSchema, zodErrorMessage } from "@/lib/http/route-response";
import { getSettings, updateSettings } from "@/lib/config-store";
import { invalidatePromptStatisticsCache } from "@/lib/prompt-statistics-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettings();
    return jsonWithSchema(SettingsResponseSchema, { settings });
  } catch {
    return errorJson("Failed to load settings.", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const body = SettingsPatchSchema.parse(await request.json());
    const settings = await updateSettings(body);
    invalidatePromptStatisticsCache();
    return jsonWithSchema(SettingsResponseSchema, { settings });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid settings payload."), 400);
    }

    return errorJson("Failed to update settings.", 500);
  }
}
