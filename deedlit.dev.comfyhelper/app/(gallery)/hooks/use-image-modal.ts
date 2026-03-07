"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { ImageRecord } from "@/lib/library-types";
import type { GenerationDetails, WorkflowDetails } from "@/lib/gallery-types";
import { useImageDetailQuery, prefetchImageDetail } from "@/lib/queries/use-image-detail";

export type ImageModalState = {
  // Selection
  selectedImage: ImageRecord | null;
  setSelectedImage: (image: ImageRecord | null) => void;
  selectedImageWithMetadata: ImageRecord | null;
  selectedImageForModal: ImageRecord | null;
  selectedImageDetails: GenerationDetails | null;
  selectedImageUrl: string;
  selectedImageIndex: number;
  isSelectedImageMetadataLoading: boolean;
  selectedImageMetadataError: string | null;

  // Navigation
  navigateSelectedImage: (direction: -1 | 1) => void;
  randomizeSelectedImage: () => void;
  handleDeletedImage: (image: Pick<ImageRecord, "id">) => void;
  closeSelectedImageModal: () => void;

  // Slideshow
  isSlideshowMode: boolean;
  setIsSlideshowMode: (value: boolean | ((current: boolean) => boolean)) => void;

  // Copy
  copiedPrompt: "positive" | "negative" | null;
  handlePromptCopy: (kind: "positive" | "negative", value: string) => Promise<void>;

  // Modal tab
  selectedModalTab: "details" | "workflow" | "raw";
  setSelectedModalTab: (tab: "details" | "workflow" | "raw") => void;

  // Workflow details (parsed on backend)
  selectedWorkflowDetails: WorkflowDetails | null;
};

export function useImageModal(
  filteredImages: ImageRecord[],
  detailsById: Map<string, GenerationDetails>,
) {
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);
  const [isSlideshowMode, setIsSlideshowMode] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState<"positive" | "negative" | null>(null);
  const [selectedModalTab, setSelectedModalTab] = useState<"details" | "workflow" | "raw">("details");
  const queryClient = useQueryClient();
  const prefetchedFullSizeRef = useRef<Set<string>>(new Set());

  // Image detail query
  const imageDetailQuery = useImageDetailQuery(selectedImage?.id ?? null);
  const selectedImageWithMetadata =
    selectedImage && imageDetailQuery.data && imageDetailQuery.data.id === selectedImage.id
      ? imageDetailQuery.data
      : null;
  const isSelectedImageMetadataLoading = selectedImage ? imageDetailQuery.isLoading : false;
  const selectedImageMetadataError = selectedImage
    ? (imageDetailQuery.error instanceof Error ? imageDetailQuery.error.message : null)
    : null;

  const selectedImageDetails = useMemo(() => {
    if (!selectedImage) return null;
    // Use backend-parsed generationDetails when available
    if (selectedImageWithMetadata && selectedImageWithMetadata.id === selectedImage.id) {
      return selectedImageWithMetadata.generationDetails ?? null;
    }
    // Fall back to detailsById (which may have client-parsed data for list view)
    return detailsById.get(selectedImage.id) ?? selectedImage.generationDetails ?? null;
  }, [detailsById, selectedImage, selectedImageWithMetadata]);

  const selectedWorkflowDetails = useMemo(() => {
    if (!selectedImageWithMetadata) return null;
    // Use backend-parsed workflowDetails
    return selectedImageWithMetadata.workflowDetails ?? null;
  }, [selectedImageWithMetadata]);

  const selectedImageUrl = useMemo(() => {
    if (!selectedImage) return "";
    return `/api/image?path=${encodeURIComponent(selectedImage.absolutePath)}`;
  }, [selectedImage]);

  const selectedImageForModal = useMemo(() => {
    if (!selectedImage) return null;
    if (selectedImageWithMetadata && selectedImageWithMetadata.id === selectedImage.id) {
      return selectedImageWithMetadata;
    }
    return selectedImage;
  }, [selectedImage, selectedImageWithMetadata]);

  const selectedImageIndex = useMemo(() => {
    if (!selectedImage) return -1;
    return filteredImages.findIndex((image) => image.id === selectedImage.id);
  }, [filteredImages, selectedImage]);

  // ── Prefetch adjacent images (metadata + full-size) ───────────────
  // When an image is selected in the modal, prefetch the next/prev images'
  // metadata and full-size image so navigation feels instant.

  useEffect(() => {
    if (!selectedImage || selectedImageIndex < 0 || filteredImages.length < 2) return;

    const total = filteredImages.length;
    const adjacentOffsets = [-1, 1, -2, 2]; // prev, next, prev-2, next+2
    const prefetched = prefetchedFullSizeRef.current;
    const inFlightPreloads: HTMLImageElement[] = [];

    // Limit tracked prefetches to avoid unbounded memory growth
    if (prefetched.size > 200) {
      prefetched.clear();
    }

    for (const offset of adjacentOffsets) {
      const adjIndex = (selectedImageIndex + offset + total) % total;
      const adjImage = filteredImages[adjIndex];
      if (!adjImage || adjImage.id === selectedImage.id) continue;

      // Prefetch image detail metadata (query cache)
      prefetchImageDetail(queryClient, adjImage.id);

      // Prefetch full-size image into browser cache
      if (!prefetched.has(adjImage.id)) {
        const fullSizeUrl = `/api/image?path=${encodeURIComponent(adjImage.absolutePath)}`;
        const preloadImage = new window.Image();
        preloadImage.decoding = "async";
        preloadImage.src = fullSizeUrl;
        inFlightPreloads.push(preloadImage);
        prefetched.add(adjImage.id);
      }
    }

    return () => {
      for (const preloadImage of inFlightPreloads) {
        if (!preloadImage.complete) {
          preloadImage.src = "data:,";
        }
      }
    };
  }, [selectedImage, selectedImageIndex, filteredImages, queryClient]);

  // ── Navigation ────────────────────────────────────────────────────

  const setSelectedImageWithReset = useCallback((image: ImageRecord | null) => {
    setSelectedImage((current) => {
      const currentId = current?.id ?? null;
      const nextId = image?.id ?? null;
      if (currentId !== nextId) {
        setCopiedPrompt(null);
        setSelectedModalTab("details");
      }
      return image;
    });
  }, []);

  const navigateSelectedImage = useCallback(
    (direction: -1 | 1) => {
      if (filteredImages.length < 2 || selectedImageIndex < 0) return;
      const total = filteredImages.length;
      const nextIndex = (selectedImageIndex + direction + total) % total;
      setSelectedImageWithReset(filteredImages[nextIndex]);
    },
    [filteredImages, selectedImageIndex, setSelectedImageWithReset],
  );

  const randomizeSelectedImage = useCallback(() => {
    if (filteredImages.length === 0) return;
    if (filteredImages.length === 1 || selectedImageIndex < 0) {
      setSelectedImageWithReset(filteredImages[0]);
      return;
    }
    let nextIndex = selectedImageIndex;
    while (nextIndex === selectedImageIndex) {
      nextIndex = Math.floor(Math.random() * filteredImages.length);
    }
    setSelectedImageWithReset(filteredImages[nextIndex]);
  }, [filteredImages, selectedImageIndex, setSelectedImageWithReset]);

  const handleDeletedImage = useCallback(
    (deletedImage: Pick<ImageRecord, "id">) => {
      const remainingImages = filteredImages.filter((image) => image.id !== deletedImage.id);
      const deletedImageIndex = filteredImages.findIndex((image) => image.id === deletedImage.id);
      const nextIndex = deletedImageIndex < 0 ? 0 : Math.min(deletedImageIndex, remainingImages.length - 1);
      setSelectedImageWithReset(remainingImages[nextIndex] ?? null);
      setIsSlideshowMode(false);
    },
    [filteredImages, setSelectedImageWithReset],
  );

  const closeSelectedImageModal = useCallback(() => {
    setIsSlideshowMode(false);
    setSelectedImageWithReset(null);
  }, [setSelectedImageWithReset]);

  // ── Prompt copy ───────────────────────────────────────────────────

  const handlePromptCopy = useCallback(async (kind: "positive" | "negative", value: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedPrompt(kind);
      window.setTimeout(() => {
        setCopiedPrompt((current) => (current === kind ? null : current));
      }, 1400);
    } catch {
      setCopiedPrompt(null);
    }
  }, []);

  // ── Effects: keyboard navigation ──────────────────────────────────

  useEffect(() => {
    if (!selectedImage) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSelectedImageModal();
        return;
      }

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTypingTarget =
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        Boolean(target?.isContentEditable);
      if (isTypingTarget) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigateSelectedImage(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        navigateSelectedImage(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedImage, closeSelectedImageModal, navigateSelectedImage]);

  // ── Effects: slideshow timer ──────────────────────────────────────

  useEffect(() => {
    if (!selectedImage || !isSlideshowMode || filteredImages.length < 2) return;
    const timer = window.setInterval(() => navigateSelectedImage(1), 2800);
    return () => window.clearInterval(timer);
  }, [selectedImage, isSlideshowMode, filteredImages.length, navigateSelectedImage]);

  // ── Effects: body scroll lock ─────────────────────────────────────

  useEffect(() => {
    if (!selectedImage) return;
    const htmlNode = document.documentElement;
    const bodyNode = document.body;
    const scrollbarWidth = Math.max(0, window.innerWidth - htmlNode.clientWidth);
    const prevHtml = htmlNode.style.overflow;
    const prevBody = bodyNode.style.overflow;
    const prevOffset = htmlNode.style.getPropertyValue("--scroll-lock-offset");
    htmlNode.style.setProperty("--scroll-lock-offset", `${scrollbarWidth}px`);
    htmlNode.style.overflow = "hidden";
    bodyNode.style.overflow = "hidden";
    return () => {
      if (prevOffset) {
        htmlNode.style.setProperty("--scroll-lock-offset", prevOffset);
      } else {
        htmlNode.style.removeProperty("--scroll-lock-offset");
      }
      htmlNode.style.overflow = prevHtml;
      bodyNode.style.overflow = prevBody;
    };
  }, [selectedImage]);

  return {
    selectedImage,
    setSelectedImage: setSelectedImageWithReset,
    selectedImageWithMetadata,
    selectedImageForModal,
    selectedImageDetails,
    selectedImageUrl,
    selectedImageIndex,
    isSelectedImageMetadataLoading,
    selectedImageMetadataError,
    navigateSelectedImage,
    randomizeSelectedImage,
    handleDeletedImage,
    closeSelectedImageModal,
    isSlideshowMode,
    setIsSlideshowMode,
    copiedPrompt,
    handlePromptCopy,
    selectedModalTab,
    setSelectedModalTab,
    selectedWorkflowDetails,
  };
}
