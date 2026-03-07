import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  ApiErrorResponseSchema,
  DeleteImageResponseSchema,
  DeleteImagesResponseSchema,
  ImageDetailResponseSchema,
  RevealImageResponseSchema,
} from "@/lib/contracts/api";
import type { ImageRecord } from "@/lib/library-types";
import { queryKeys } from "@/lib/queries/query-keys";

// ---------------------------------------------------------------------------
// Image detail query
// ---------------------------------------------------------------------------

async function fetchImageDetail(id: string, signal?: AbortSignal): Promise<ImageRecord> {
  const response = await fetch(`/api/images/detail?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal,
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const parsedError = ApiErrorResponseSchema.safeParse(payload);
    throw new Error(parsedError.success ? parsedError.data.error : "Failed to load image details.");
  }
  return ImageDetailResponseSchema.parse(payload).image;
}

export function useImageDetailQuery(id: string | null) {
  return useQuery({
    queryKey: queryKeys.imageDetail(id),
    queryFn: ({ signal }) => fetchImageDetail(id!, signal),
    enabled: !!id,
    // Image metadata rarely changes — cache for 5 minutes
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * Prefetch image detail data into the query cache.
 * Used to warm the cache for adjacent images in the modal.
 */
export function prefetchImageDetail(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
) {
  void queryClient.prefetchQuery({
    queryKey: queryKeys.imageDetail(id),
    queryFn: ({ signal }) => fetchImageDetail(id, signal),
    staleTime: 5 * 60 * 1000,
  });
}


// ---------------------------------------------------------------------------
// Delete image mutation (filesystem + cache)
// ---------------------------------------------------------------------------

export function useDeleteImageMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, absolutePath }: { id: string; absolutePath: string }) => {
      const response = await fetch("/api/image", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, path: absolutePath }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const parsedError = ApiErrorResponseSchema.safeParse(payload);
        throw new Error(parsedError.success ? parsedError.data.error : "Failed to move image to trash.");
      }
      DeleteImageResponseSchema.parse(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
      void queryClient.invalidateQueries({ queryKey: ["imageDetail"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats() });
    },
  });
}

// ---------------------------------------------------------------------------
// Delete multiple images mutation (filesystem + cache)
// ---------------------------------------------------------------------------

export type DeleteImagesMutationResult = {
  total: number;
  moved: number;
  movedPaths: string[];
  failed: Array<{ path: string; error: string }>;
};

export function useDeleteImagesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (absolutePaths: string[]): Promise<DeleteImagesMutationResult> => {
      const response = await fetch("/api/images/trash", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: absolutePaths }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const parsedError = ApiErrorResponseSchema.safeParse(payload);
        throw new Error(parsedError.success ? parsedError.data.error : "Failed to move selected images to trash.");
      }
      return DeleteImagesResponseSchema.parse(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
      void queryClient.invalidateQueries({ queryKey: ["imageDetail"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats() });
    },
  });
}
