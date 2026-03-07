import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";

import {
  AddRootResponseSchema,
  ApiErrorResponseSchema,
  RemoveRootResponseSchema,
  RootsListResponseSchema,
  UpdateRootVisibilityResponseSchema,
} from "@/lib/contracts/api";
import type { RootDirectory } from "@/lib/library-types";
import { queryKeys } from "@/lib/queries/query-keys";
import { statusMessageAtom } from "@/lib/store/scan-atoms";

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

async function fetchRoots(): Promise<RootDirectory[]> {
  const response = await fetch("/api/roots", { cache: "no-store" });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const parsedError = ApiErrorResponseSchema.safeParse(payload);
    throw new Error(parsedError.success ? parsedError.data.error : "Failed to load root directories.");
  }

  const parsed = RootsListResponseSchema.parse(payload);
  return parsed.roots ?? [];
}

export function useRootsQuery() {
  return useQuery({
    queryKey: queryKeys.roots(),
    queryFn: fetchRoots,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useAddRootMutation() {
  const queryClient = useQueryClient();
  const setStatusMessage = useSetAtom(statusMessageAtom);

  return useMutation({
    mutationFn: async (path: string) => {
      const response = await fetch("/api/roots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const parsedError = ApiErrorResponseSchema.safeParse(payload);
        throw new Error(parsedError.success ? parsedError.data.error : "Failed to add root directory.");
      }
      return AddRootResponseSchema.parse(payload).root;
    },
    onSuccess: () => {
      setStatusMessage("Root directory added.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.roots() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
    },
  });
}

export function useRemoveRootMutation() {
  const queryClient = useQueryClient();
  const setStatusMessage = useSetAtom(statusMessageAtom);

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/roots/${id}`, { method: "DELETE" });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const parsedError = ApiErrorResponseSchema.safeParse(payload);
        throw new Error(parsedError.success ? parsedError.data.error : "Failed to remove root directory.");
      }
      RemoveRootResponseSchema.parse(payload);
    },
    onSuccess: () => {
      setStatusMessage("Root directory removed.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.roots() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
    },
  });
}

export function useToggleRootVisibilityMutation() {
  const queryClient = useQueryClient();
  const setStatusMessage = useSetAtom(statusMessageAtom);

  return useMutation({
    mutationFn: async ({ id, isVisible }: { id: string; isVisible: boolean }) => {
      const response = await fetch(`/api/roots/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isVisible }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const parsedError = ApiErrorResponseSchema.safeParse(payload);
        throw new Error(parsedError.success ? parsedError.data.error : "Failed to update root visibility.");
      }
      return UpdateRootVisibilityResponseSchema.parse(payload).root;
    },
    onSuccess: (_data, variables) => {
      setStatusMessage(variables.isVisible ? "Root is visible again." : "Root hidden from gallery scans.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.roots() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
    },
  });
}
