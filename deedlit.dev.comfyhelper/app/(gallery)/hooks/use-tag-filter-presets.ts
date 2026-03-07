"use client";

import { useCallback, useEffect, useState } from "react";

import type { TagFilterPreset } from "@/lib/library-types";
import {
  normalizePresetName,
  normalizePresetTags,
  parsePresetTagDraft,
} from "@/lib/tag-filter-utils";

export type TagFilterPresetsState = {
  activeTagFilterPresetId: string;
  setActiveTagFilterPresetId: (id: string) => void;
  activeTagFilterPreset: TagFilterPreset | null;
  newTagPresetName: string;
  setNewTagPresetName: (name: string) => void;
  presetPositiveTagDraft: string;
  setPresetPositiveTagDraft: (value: string) => void;
  presetNegativeTagDraft: string;
  setPresetNegativeTagDraft: (value: string) => void;
  isDeletingTagPresetId: string | null;

  createTagFilterPreset: () => Promise<void>;
  deleteTagFilterPreset: (presetId: string) => Promise<void>;
  updateTagFilterPreset: (
    presetId: string,
    nextValue: { name?: string; positiveTags?: string[]; negativeTags?: string[] },
  ) => Promise<boolean>;
  addTagToActivePreset: (kind: "positive" | "negative") => Promise<void>;
  updateActivePresetFromSelectedFilters: () => Promise<void>;
};

export function useTagFilterPresets(
  tagFilterPresets: TagFilterPreset[],
  selectedPositiveTags: string[],
  selectedNegativeTags: string[],
  savePresets: (nextPresets: TagFilterPreset[]) => Promise<void>,
  setErrorMessage: (message: string | null) => void,
  activeTagFilterPresetId: string,
  setActiveTagFilterPresetId: (id: string) => void,
): TagFilterPresetsState {
  const [newTagPresetName, setNewTagPresetName] = useState<string>("");
  const [presetPositiveTagDraft, setPresetPositiveTagDraft] = useState<string>("");
  const [presetNegativeTagDraft, setPresetNegativeTagDraft] = useState<string>("");
  const [isDeletingTagPresetId, setIsDeletingTagPresetId] = useState<string | null>(null);

  const activeTagFilterPreset =
    activeTagFilterPresetId === "none"
      ? null
      : tagFilterPresets.find((p) => p.id === activeTagFilterPresetId) ?? null;

  // Clean up stale preset reference
  useEffect(() => {
    if (activeTagFilterPresetId === "none") return;
    if (!tagFilterPresets.some((p) => p.id === activeTagFilterPresetId)) {
      setActiveTagFilterPresetId("none");
    }
  }, [tagFilterPresets, activeTagFilterPresetId, setActiveTagFilterPresetId]);

  // Reset drafts when active preset changes
  useEffect(() => {
    setPresetPositiveTagDraft("");
    setPresetNegativeTagDraft("");
  }, [activeTagFilterPresetId]);

  const updateTagFilterPreset = useCallback(
    async (
      presetId: string,
      nextValue: { name?: string; positiveTags?: string[]; negativeTags?: string[] },
    ): Promise<boolean> => {
      const currentPreset = tagFilterPresets.find((p) => p.id === presetId);
      if (!currentPreset) {
        setErrorMessage("Preset not found.");
        return false;
      }

      const updatedPreset: TagFilterPreset = {
        ...currentPreset,
        ...(nextValue.name !== undefined ? { name: normalizePresetName(nextValue.name) } : {}),
        positiveTags: normalizePresetTags(nextValue.positiveTags ?? currentPreset.positiveTags),
        negativeTags: normalizePresetTags(nextValue.negativeTags ?? currentPreset.negativeTags),
      };

      if (!updatedPreset.name) {
        setErrorMessage("Preset name is required.");
        return false;
      }
      if (updatedPreset.positiveTags.length === 0 && updatedPreset.negativeTags.length === 0) {
        setErrorMessage("Preset must include at least one positive or negative tag.");
        return false;
      }

      const nextPresets = tagFilterPresets
        .map((p) => (p.id === presetId ? updatedPreset : p))
        .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt));

      await savePresets(nextPresets);
      return true;
    },
    [tagFilterPresets, savePresets, setErrorMessage],
  );

  const createTagFilterPreset = useCallback(async () => {
    const normalizedName = normalizePresetName(newTagPresetName);
    const positiveTags = normalizePresetTags(selectedPositiveTags);
    const negativeTags = normalizePresetTags(selectedNegativeTags);

    if (!normalizedName) {
      setErrorMessage("Preset name is required.");
      return;
    }
    if (positiveTags.length === 0 && negativeTags.length === 0) {
      setErrorMessage("Select at least one positive or negative tag to create a preset.");
      return;
    }

    const nextPreset: TagFilterPreset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: normalizedName,
      positiveTags,
      negativeTags,
      createdAt: new Date().toISOString(),
    };
    const nextPresets = [...tagFilterPresets, nextPreset].sort(
      (a, b) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt),
    );

    await savePresets(nextPresets);
    setActiveTagFilterPresetId(nextPreset.id);
    setNewTagPresetName("");
  }, [
    newTagPresetName,
    selectedPositiveTags,
    selectedNegativeTags,
    tagFilterPresets,
    savePresets,
    setErrorMessage,
    setActiveTagFilterPresetId,
  ]);

  const deleteTagFilterPreset = useCallback(
    async (presetId: string) => {
      setIsDeletingTagPresetId(presetId);
      const nextPresets = tagFilterPresets.filter((p) => p.id !== presetId);
      try {
        await savePresets(nextPresets);
        if (activeTagFilterPresetId === presetId) setActiveTagFilterPresetId("none");
      } finally {
        setIsDeletingTagPresetId(null);
      }
    },
    [activeTagFilterPresetId, tagFilterPresets, savePresets, setActiveTagFilterPresetId],
  );

  const addTagToActivePreset = useCallback(
    async (kind: "positive" | "negative") => {
      if (!activeTagFilterPreset) {
        setErrorMessage("Select a preset before updating tags.");
        return;
      }

      const parsedTags =
        kind === "positive"
          ? parsePresetTagDraft(presetPositiveTagDraft)
          : parsePresetTagDraft(presetNegativeTagDraft);
      if (parsedTags.length === 0) {
        setErrorMessage(`Enter at least one ${kind} tag.`);
        return;
      }

      const nextPositive =
        kind === "positive"
          ? normalizePresetTags([...activeTagFilterPreset.positiveTags, ...parsedTags])
          : activeTagFilterPreset.positiveTags;
      const nextNegative =
        kind === "negative"
          ? normalizePresetTags([...activeTagFilterPreset.negativeTags, ...parsedTags])
          : activeTagFilterPreset.negativeTags;

      const updated = await updateTagFilterPreset(activeTagFilterPreset.id, {
        positiveTags: nextPositive,
        negativeTags: nextNegative,
      });
      if (updated) {
        if (kind === "positive") setPresetPositiveTagDraft("");
        else setPresetNegativeTagDraft("");
      }
    },
    [
      activeTagFilterPreset,
      presetPositiveTagDraft,
      presetNegativeTagDraft,
      updateTagFilterPreset,
      setErrorMessage,
    ],
  );

  const updateActivePresetFromSelectedFilters = useCallback(async () => {
    if (!activeTagFilterPreset) {
      setErrorMessage("Select a preset before applying selected filters.");
      return;
    }

    const nextPositive = normalizePresetTags([
      ...activeTagFilterPreset.positiveTags,
      ...selectedPositiveTags,
    ]);
    const nextNegative = normalizePresetTags([
      ...activeTagFilterPreset.negativeTags,
      ...selectedNegativeTags,
    ]);

    await updateTagFilterPreset(activeTagFilterPreset.id, {
      positiveTags: nextPositive,
      negativeTags: nextNegative,
    });
  }, [activeTagFilterPreset, selectedPositiveTags, selectedNegativeTags, updateTagFilterPreset, setErrorMessage]);

  return {
    activeTagFilterPresetId,
    setActiveTagFilterPresetId,
    activeTagFilterPreset,
    newTagPresetName,
    setNewTagPresetName,
    presetPositiveTagDraft,
    setPresetPositiveTagDraft,
    presetNegativeTagDraft,
    setPresetNegativeTagDraft,
    isDeletingTagPresetId,
    createTagFilterPreset,
    deleteTagFilterPreset,
    updateTagFilterPreset,
    addTagToActivePreset,
    updateActivePresetFromSelectedFilters,
  };
}
