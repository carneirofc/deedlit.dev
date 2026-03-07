"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";

import type { ImageRecord, RootDirectory, TagFilterPreset } from "@/lib/library-types";
import { useLibraryQuery, useStartScanMutation } from "@/lib/queries/use-library";
import {
  useDeleteImageMutation,
  useDeleteImagesMutation,
} from "@/lib/queries/use-image-detail";
import { useSaveSettingsMutation } from "@/lib/queries/use-settings";
import { scanJobAtom, scanFeedbackAtom } from "@/lib/store/scan-atoms";
import type { ScanJobInfo } from "@/lib/library-types";

const emptyExcludedTags: string[] = [];

export type GalleryLibraryState = {
  // Data
  roots: RootDirectory[];
  images: ImageRecord[];
  warnings: string[];
  scannedAt: string | null;
  galleryColumns: number;
  excludedTags: string[];
  tagFilterPresets: TagFilterPreset[];
  totalImages: number;
  isLibraryTruncated: boolean;
  appliedImageLimit: number | null;

  // Status flags
  isLoading: boolean;
  isStartingScan: boolean;
  isSavingTagPreset: boolean;
  isDeletingImage: boolean;
  isScanActive: boolean;

  // Scan state
  scanJob: ScanJobInfo | null;
  scanFeedback: string | null;
  scanProgressPercent: number | undefined;

  // Error / feedback
  errorMessage: string | null;
  setErrorMessage: (message: string | null) => void;

  // Actions
  handleStartScan: () => Promise<void>;
  handleRecheckExtraction: () => Promise<void>;
  handleDeleteImage: (image: ImageRecord) => Promise<boolean>;
  handleDeleteImages: (images: ImageRecord[]) => Promise<{
    total: number;
    moved: number;
    movedPaths: string[];
    failed: Array<{ path: string; error: string }>;
  }>;
  saveTagFilterPresets: (nextPresets: TagFilterPreset[]) => Promise<void>;
};

export function useGalleryLibrary(): GalleryLibraryState {
  const libraryQuery = useLibraryQuery();
  const startScanMutation = useStartScanMutation();
  const saveSettingsMutation = useSaveSettingsMutation();
  const deleteImageMutation = useDeleteImageMutation();
  const deleteImagesMutation = useDeleteImagesMutation();
  const scanJob = useAtomValue(scanJobAtom);
  const scanFeedback = useAtomValue(scanFeedbackAtom);
  const setScanFeedback = useSetAtom(scanFeedbackAtom);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Derived from library query data
  const roots = libraryQuery.data?.roots ?? [];
  const images = libraryQuery.data?.images ?? [];
  const warnings = libraryQuery.data?.warnings ?? [];
  const scannedAt = libraryQuery.data?.scannedAt ?? null;
  const galleryColumns = libraryQuery.data?.settings?.galleryColumns ?? 5;
  const excludedTags = libraryQuery.data?.settings?.excludedTags ?? emptyExcludedTags;
  const tagFilterPresets = libraryQuery.data?.settings?.tagFilterPresets ?? [];
  const totalImages = libraryQuery.data?.total ?? 0;
  const isLibraryTruncated = Boolean(libraryQuery.data?.truncated);
  const appliedImageLimit = libraryQuery.data?.limitApplied ?? null;
  const isLoading = libraryQuery.isLoading;
  const isStartingScan = startScanMutation.isPending;
  const isSavingTagPreset = saveSettingsMutation.isPending;
  const isDeletingImage = deleteImageMutation.isPending || deleteImagesMutation.isPending;

  const isScanActive = scanJob?.status === "queued" || scanJob?.status === "running";

  const scanProgressPercent = useMemo(() => {
    if (!scanJob) return undefined;
    if (scanJob.totalFiles <= 0) return scanJob.status === "queued" ? 4 : 8;
    return (scanJob.processedFiles / scanJob.totalFiles) * 100;
  }, [scanJob]);

  const handleStartScan = useCallback(async () => {
    setErrorMessage(null);
    try {
      const result = await startScanMutation.mutateAsync({});
      setScanFeedback(result.started ? "Scan started in background." : "A scan is already running.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected error while starting image scan.";
      setErrorMessage(message);
    }
  }, [startScanMutation, setScanFeedback]);

  const handleRecheckExtraction = useCallback(async () => {
    setErrorMessage(null);
    try {
      const result = await startScanMutation.mutateAsync({ force: true });
      setScanFeedback(
        result.started
          ? "Forced metadata recheck started in background."
          : "A scan is already running.",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected error while starting metadata recheck.";
      setErrorMessage(message);
    }
  }, [startScanMutation, setScanFeedback]);

  const saveTagFilterPresets = useCallback(
    async (nextPresets: TagFilterPreset[]) => {
      setErrorMessage(null);
      try {
        await saveSettingsMutation.mutateAsync({ tagFilterPresets: nextPresets });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected error while saving tag presets.";
        setErrorMessage(message);
      }
    },
    [saveSettingsMutation],
  );

  const handleDeleteImage = useCallback(
    async (image: ImageRecord) => {
      setErrorMessage(null);
      try {
        await deleteImageMutation.mutateAsync({ id: image.id, absolutePath: image.absolutePath });
        const feedback = "Image moved to trash.";
        setScanFeedback(feedback);
        window.setTimeout(() => {
          setScanFeedback((current) => (current === feedback ? null : current));
        }, 2200);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to move image to trash.";
        setErrorMessage(message);
        return false;
      }
    },
    [deleteImageMutation, setScanFeedback],
  );

  const handleDeleteImages = useCallback(
    async (images: ImageRecord[]) => {
      const absolutePaths = Array.from(
        new Set(images.map((image) => image.absolutePath).filter((pathValue) => pathValue.length > 0)),
      );

      if (absolutePaths.length === 0) {
        return { total: 0, moved: 0, movedPaths: [], failed: [] };
      }

      setErrorMessage(null);
      try {
        const result = await deleteImagesMutation.mutateAsync(absolutePaths);
        const failedCount = result.failed.length;
        const feedback =
          failedCount === 0
            ? `${result.moved} image${result.moved === 1 ? "" : "s"} moved to trash.`
            : `Moved ${result.moved} of ${result.total} image${result.total === 1 ? "" : "s"} to trash (${failedCount} failed).`;
        setScanFeedback(feedback);
        window.setTimeout(() => {
          setScanFeedback((current) => (current === feedback ? null : current));
        }, 3000);

        if (failedCount > 0) {
          setErrorMessage(result.failed[0]?.error ?? "Some images could not be moved to trash.");
        }
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to move selected images to trash.";
        setErrorMessage(message);
        return { total: absolutePaths.length, moved: 0, movedPaths: [], failed: [] };
      }
    },
    [deleteImagesMutation, setScanFeedback],
  );

  // Auto-start scan when roots exist but no images yet
  useEffect(() => {
    if (roots.length === 0 || images.length > 0 || isScanActive || isStartingScan) return;
    queueMicrotask(() => {
      void handleStartScan();
    });
  }, [isLoading, roots.length, images.length, isScanActive, isStartingScan, handleStartScan]);

  return {
    roots,
    images,
    warnings,
    scannedAt,
    galleryColumns,
    excludedTags,
    tagFilterPresets,
    totalImages,
    isLibraryTruncated,
    appliedImageLimit,
    isLoading,
    isStartingScan,
    isSavingTagPreset,
    isDeletingImage,
    isScanActive,
    scanJob,
    scanFeedback,
    scanProgressPercent,
    errorMessage,
    setErrorMessage,
    handleStartScan,
    handleRecheckExtraction,
    handleDeleteImage,
    handleDeleteImages,
    saveTagFilterPresets,
  };
}
