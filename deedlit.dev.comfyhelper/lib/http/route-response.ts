import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny } from "zod";

import { ApiErrorResponseSchema } from "@/lib/contracts/api";

export function jsonWithSchema<TSchema extends ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  init?: ResponseInit,
) {
  const parsed = schema.parse(value);
  return NextResponse.json(parsed, init);
}

export function errorJson(message: string, status: number) {
  return NextResponse.json(ApiErrorResponseSchema.parse({ error: message }), { status });
}

export function zodErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ZodError)) {
    return fallback;
  }

  return error.issues[0]?.message ?? fallback;
}
