import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";

import {
  ApiErrorResponseSchema,
  DeleteCachedImageResponseSchema,
  ImagesResponseSchema,
  StartScanResponseSchema,
} from "@/lib/contracts/api";
import type { ImageRecord, ScanJobInfo, ScanResult } from "@/lib/library-types";
import { queryKeys } from "@/lib/queries/query-keys";
import { scanJobAtom, scanImageCountAtom, statusMessageAtom } from "@/lib/store/scan-atoms";

// ---------------------------------------------------------------------------
// Library query (gallery — full image list, no pagination)
// ---------------------------------------------------------------------------

const DEFAULT_GALLERY_IMAGE_LIMIT = 10000;
const LOW_MEMORY_GALLERY_IMAGE_LIMIT = 5000;

function resolveGalleryImageLimit(): number {
  if (typeof navigator === "undefined") {
    return DEFAULT_GALLERY_IMAGE_LIMIT;
  }

  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof deviceMemory === "number" && deviceMemory <= 4) {
    return LOW_MEMORY_GALLERY_IMAGE_LIMIT;
  }

  return DEFAULT_GALLERY_IMAGE_LIMIT;
}

export type LibraryData = {
  roots: ScanResult["roots"];
  settings: ScanResult["settings"];
  images: ImageRecord[];
  warnings: string[];
  scannedAt: string | null;
  scan: ScanJobInfo | null;
  total: number;
  truncated: boolean;
  limitApplied: number | null;
};

async function fetchLibrary(signal?: AbortSignal): Promise<LibraryData> {
  const imageLimit = resolveGalleryImageLimit();
  const response = await fetch(`/api/images?limit=${imageLimit}`, { cache: "no-store", signal });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const parsedError = ApiErrorResponseSchema.safeParse(payload);
    throw new Error(parsedError.success ? parsedError.data.error : "Failed to load image library.");
  }
  const result = ImagesResponseSchema.parse(payload) as ScanResult;
  const images = result.images ?? [];
  const total = typeof result.total === "number" ? result.total : images.length;
  
  // Use the configured limit from settings if available, otherwise fall back to memory-based limit
  const effectiveLimit = result.settings?.galleryImageLimit ?? imageLimit;
  
  return {
    roots: result.roots ?? [],
    settings: result.settings ?? { galleryColumns: 7, galleryImageLimit: DEFAULT_GALLERY_IMAGE_LIMIT, excludedTags: [], tagFilterPresets: [], trashcanDirectory: null },
    images,
    warnings: result.warnings ?? [],
    scannedAt: result.scannedAt ?? null,
    scan: result.scan ?? null,
    total,
    truncated: Boolean(result.truncated),
    limitApplied:
      typeof result.limitApplied === "number" && result.limitApplied > 0 ? result.limitApplied : effectiveLimit,
  };
}

export function useLibraryQuery() {
  const setScanJob = useSetAtom(scanJobAtom);

  return useQuery({
    queryKey: queryKeys.library(),
    queryFn: async ({ signal }) => {
      const data = await fetchLibrary(signal);
      // Sync the scan job atom from the API response
      setScanJob(data.scan);
      return data;
    },
    // Keep data fresh for 30s — SSE patches handle real-time updates between fetches
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Admin paginated images query
// ---------------------------------------------------------------------------

export type AdminImagesData = {
  images: ImageRecord[];
  total: number;
  scan: ScanJobInfo | null;
  scannedAt: string | null;
  warnings: string[];
};

async function fetchAdminImages(
  page: number,
  pageSize: number,
  search: string,
  signal?: AbortSignal,
): Promise<AdminImagesData> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (search.trim()) params.set("search", search.trim());

  const response = await fetch(`/api/images?${params.toString()}`, { cache: "no-store", signal });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const parsedError = ApiErrorResponseSchema.safeParse(payload);
    throw new Error(parsedError.success ? parsedError.data.error : "Failed to load scanned files.");
  }
  const parsed = ImagesResponseSchema.parse(payload);

  return {
    images: parsed.images ?? [],
    total: parsed.total ?? 0,
    scan: parsed.scan ?? null,
    scannedAt: parsed.scannedAt ?? null,
    warnings: parsed.warnings ?? [],
  };
}

export function useAdminImagesQuery(page: number, pageSize: number, search: string) {
  const setScanJob = useSetAtom(scanJobAtom);
  const setScanImageCount = useSetAtom(scanImageCountAtom);

  return useQuery({
    queryKey: queryKeys.images({ page, pageSize, search }),
    queryFn: async ({ signal }) => {
      const data = await fetchAdminImages(page, pageSize, search, signal);
      if (data.scan) {
        setScanJob(data.scan);
        setScanImageCount(data.scan.cachedImages);
      }
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Start scan mutation
// ---------------------------------------------------------------------------

export function useStartScanMutation() {
  const setScanJob = useSetAtom(scanJobAtom);
  const setScanImageCount = useSetAtom(scanImageCountAtom);

  return useMutation({
    mutationFn: async (options?: { force?: boolean }) => {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options?.force ? { force: true } : {}),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const parsedError = ApiErrorResponseSchema.safeParse(payload);
        throw new Error(parsedError.success ? parsedError.data.error : "Failed to run library scan.");
      }
      return StartScanResponseSchema.parse(payload);
    },
    onSuccess: (data) => {
      if (data.job) {
        setScanJob(data.job);
        setScanImageCount(data.job.cachedImages);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Delete cached image mutation
// ---------------------------------------------------------------------------

export function useDeleteCachedImageMutation() {
  const queryClient = useQueryClient();
  const setStatusMessage = useSetAtom(statusMessageAtom);

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch("/api/images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const parsedError = ApiErrorResponseSchema.safeParse(payload);
        throw new Error(parsedError.success ? parsedError.data.error : "Failed to delete cached entry.");
      }
      DeleteCachedImageResponseSchema.parse(payload);
    },
    onSuccess: () => {
      setStatusMessage("Cached image entry removed.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.library() });
    },
  });
}
