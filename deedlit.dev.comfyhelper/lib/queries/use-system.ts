import { useQuery } from "@tanstack/react-query";

import { ApiErrorResponseSchema, SystemInfoResponseSchema } from "@/lib/contracts/api";
import { queryKeys } from "@/lib/queries/query-keys";

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export type SystemInfo = {
  sqlite: {
    relativePath: string;
    absolutePath: string;
    fileSizeBytes: number | null;
    baseDirectory: string;
    profile: "dev" | "live";
  } | null;
  database: {
    tableRows: { rootDirectories: number; appSettings: number; imageCache: number; scanJobs: number };
    roots: { total: number; visible: number; hidden: number };
  } | null;
  library: {
    visibleCachedImages: number;
  } | null;
};

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

async function fetchSystemInfo(): Promise<SystemInfo> {
  const response = await fetch("/api/system", { cache: "no-store" });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const parsedError = ApiErrorResponseSchema.safeParse(payload);
    throw new Error(parsedError.success ? parsedError.data.error : "Failed to load system information.");
  }

  const parsed = SystemInfoResponseSchema.parse(payload);
  return {
    sqlite: parsed.sqlite ?? null,
    database: parsed.database ?? null,
    library: parsed.library ?? null,
  };
}

export function useSystemInfoQuery() {
  return useQuery({
    queryKey: queryKeys.system(),
    queryFn: fetchSystemInfo,
  });
}
