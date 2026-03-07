import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";

import { ApiErrorResponseSchema, SettingsResponseSchema } from "@/lib/contracts/api";
import type { AppSettings, TagFilterPreset } from "@/lib/library-types";
import { queryKeys } from "@/lib/queries/query-keys";
import { statusMessageAtom } from "@/lib/store/scan-atoms";

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

async function fetchSettings(): Promise<AppSettings> {
  const response = await fetch("/api/settings", { cache: "no-store" });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const parsedError = ApiErrorResponseSchema.safeParse(payload);
    throw new Error(parsedError.success ? parsedError.data.error : "Failed to load settings.");
  }

  const parsed = SettingsResponseSchema.parse(payload);
  return parsed.settings ?? { galleryColumns: 7, excludedTags: [], tagFilterPresets: [], trashcanDirectory: null };
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: fetchSettings,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

type SettingsPatch = {
  galleryColumns?: number;
  galleryImageLimit?: number;
  excludedTags?: string[];
  tagFilterPresets?: TagFilterPreset[];
  trashcanDirectory?: string | null;
};

export function useSaveSettingsMutation() {
  const queryClient = useQueryClient();
  const setStatusMessage = useSetAtom(statusMessageAtom);

  return useMutation({
    mutationFn: async (patch: SettingsPatch) => {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const parsedError = ApiErrorResponseSchema.safeParse(payload);
        throw new Error(parsedError.success ? parsedError.data.error : "Failed to update settings.");
      }
      const parsed = SettingsResponseSchema.parse(payload);
      return parsed.settings;
    },
    onSuccess: () => {
      setStatusMessage("Settings updated.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.library() });
    },
  });
}
