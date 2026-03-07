export function nowMs(): number {
  return Date.now();
}

export function toIsoDateTime(value: number): string {
  return new Date(value).toISOString();
}

export function toOptionalIsoDateTime(value?: number | null): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return toIsoDateTime(value);
}

export function nowIsoDateTime(): string {
  return toIsoDateTime(nowMs());
}