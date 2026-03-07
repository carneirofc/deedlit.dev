import type { ZodType } from "zod";

export function tryParseJson(raw: string | null | undefined): unknown {
  if (typeof raw !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function tryParseJsonWithSchema<T>(
  raw: string | null | undefined,
  schema: ZodType<T>,
): T | undefined {
  const value = tryParseJson(raw);
  if (value === undefined) {
    return undefined;
  }

  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}