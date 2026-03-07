"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type RefObject,
} from "react";

import { EmptyState, OutlineButton } from "@deedlit.dev/ui";
import type { ImageRecord } from "@/lib/library-types";
import type { CollectionsHook } from "../hooks";
import { GalleryImageCard } from "./GalleryImageCard";
import { toNextImagePrefetchSrc } from "@/lib/image-utils";

const PREFETCH_AHEAD_COUNT = 10;
const MAX_TRACKED_PREFETCHED_IMAGES = 600;
const NEXT_IMAGE_PREFETCH_WIDTH = 640;
const NEXT_IMAGE_PREFETCH_WIDTH_HIDPI = 1080;


type NetworkInformation = {
  saveData?: boolean;
  effectiveType?: string;
};

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type WindowWithIdleCallbacks = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function shouldPrefetchImages(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (
    navigator as Navigator & { connection?: NetworkInformation }
  ).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return (
    connection.effectiveType !== "slow-2g" && connection.effectiveType !== "2g"
  );
}

type GalleryImageGridProps = {
  isLoading: boolean;
  isScanActive: boolean;
  filteredImages: ImageRecord[];
  visibleImages: ImageRecord[];
  visibleImageCount: number;
  windowStart: number;
  galleryColumns: number;
  canShowMoreImages: boolean;
  canShowPreviousImages: boolean;
  galleryGridRef: RefObject<HTMLDivElement | null>;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  loadPreviousSentinelRef: RefObject<HTMLDivElement | null>;
  topSpacerHeight: number;
  galleryGridStyle: CSSProperties;
  selectedImageIds: ReadonlySet<string>;
  onToggleImageSelection: (imageId: string, isSelected: boolean) => void;
  onSelectImage: (image: ImageRecord) => void;
  onDeleteKeyPressed: (activeImageId: string | null) => void;
  onShowMoreImages: () => void;
  isImageDetailsModalOpen: boolean;
  collections?: CollectionsHook;
};

const GalleryImageCardMemo = memo(
  GalleryImageCard,
  (previousProps, nextProps) =>
    previousProps.image === nextProps.image &&
    previousProps.index === nextProps.index &&
    previousProps.isSelected === nextProps.isSelected &&
    previousProps.isKeyboardActive === nextProps.isKeyboardActive &&
    previousProps.isFavourite === nextProps.isFavourite &&
    previousProps.imageSizes === nextProps.imageSizes &&
    previousProps.setCardRef === nextProps.setCardRef &&
    previousProps.onCardFocus === nextProps.onCardFocus &&
    previousProps.onImageClick === nextProps.onImageClick &&
    previousProps.onToggleImageSelection === nextProps.onToggleImageSelection &&
    previousProps.onToggleFavourite === nextProps.onToggleFavourite &&
    previousProps.focusAndScrollImageAtIndex === nextProps.focusAndScrollImageAtIndex &&
    previousProps.onHoverPrefetch === nextProps.onHoverPrefetch,
);

export default function GalleryImageGrid({
  isLoading,
  isScanActive,
  filteredImages,
  visibleImages,
  visibleImageCount,
  windowStart,
  galleryColumns,
  canShowMoreImages,
  canShowPreviousImages,
  galleryGridRef,
  loadMoreSentinelRef,
  loadPreviousSentinelRef,
  topSpacerHeight,
  galleryGridStyle,
  selectedImageIds,
  onToggleImageSelection,
  onSelectImage,
  onDeleteKeyPressed,
  onShowMoreImages,
  isImageDetailsModalOpen,
  collections,
}: GalleryImageGridProps) {
  const prefetchedImageUrlsRef = useRef<Set<string>>(new Set());
  const imageCardRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);
  const selectedImageCount = selectedImageIds.size;
  // With MIN_GALLERY_CARD_WIDTH = 256px: phones (<560px) → 1 col, up to 640px → 2 cols, etc.
  const imageSizes = "(max-width: 560px) 100vw, (max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw";
  const shouldPrefetch = shouldPrefetchImages();
  const favouriteImageIds = useMemo(
    () => new Set(collections?.favourites.map((image) => image.id) ?? []),
    [collections?.favourites],
  );

  useEffect(() => {
    if (!shouldPrefetch) return;

    const prefetchedImageUrls = prefetchedImageUrlsRef.current;
    const inFlightPreloads: HTMLImageElement[] = [];
    if (prefetchedImageUrls.size > MAX_TRACKED_PREFETCHED_IMAGES) {
      prefetchedImageUrls.clear();
    }

    const imagesToPrefetch = filteredImages.slice(
      windowStart + visibleImageCount,
      windowStart + visibleImageCount + PREFETCH_AHEAD_COUNT,
    );
    if (imagesToPrefetch.length === 0) return;

    const prefetchWidth =
      window.devicePixelRatio > 1.5
        ? NEXT_IMAGE_PREFETCH_WIDTH_HIDPI
        : NEXT_IMAGE_PREFETCH_WIDTH;

    const prefetchImages = () => {
      for (const image of imagesToPrefetch) {
        const imageUrl = toNextImagePrefetchSrc(
          image.absolutePath,
          prefetchWidth,
        );
        if (prefetchedImageUrls.has(imageUrl)) {
          continue;
        }

        const preloadImage = new window.Image();
        preloadImage.decoding = "async";
        preloadImage.src = imageUrl;
        inFlightPreloads.push(preloadImage);
        prefetchedImageUrls.add(imageUrl);
      }
    };

    const windowWithIdle = window as WindowWithIdleCallbacks;
    let idleCallbackId: number | null = null;
    let timeoutId: number | null = null;

    if (typeof windowWithIdle.requestIdleCallback === "function") {
      idleCallbackId = windowWithIdle.requestIdleCallback(
        prefetchImages,
        {
          timeout: 300,
        },
      );
    } else {
      timeoutId = window.setTimeout(prefetchImages, 0);
    }

    return () => {
      if (idleCallbackId !== null) {
        windowWithIdle.cancelIdleCallback?.(idleCallbackId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      for (const preloadImage of inFlightPreloads) {
        if (!preloadImage.complete) {
          preloadImage.src = "data:,";
        }
      }
    };
  }, [filteredImages, shouldPrefetch, visibleImageCount, windowStart]);

  const clampedActiveImageIndex =
    visibleImages.length === 0
      ? -1
      : Math.max(0, Math.min(activeImageIndex, visibleImages.length - 1));

  const focusAndScrollImageAtIndex = useCallback(
    (nextIndex: number) => {
      if (visibleImages.length === 0) return;
      const clampedIndex = Math.max(
        0,
        Math.min(nextIndex, visibleImages.length - 1),
      );
      setActiveImageIndex(clampedIndex);
      const targetCard = imageCardRefs.current[clampedIndex];
      if (!targetCard) return;
      targetCard.scrollIntoView({ block: "nearest", inline: "nearest" });
      targetCard.focus();
    },
    [visibleImages.length],
  );
  const setCardRef = useCallback((index: number, node: HTMLElement | null) => {
    imageCardRefs.current[index] = node;
  }, []);
  const handleCardFocus = useCallback((index: number) => {
    setActiveImageIndex(index);
  }, []);

  const handleImageClick = useCallback(
    (
      event: MouseEvent<HTMLButtonElement>,
      image: ImageRecord,
      imageIndex: number,
      isSelected: boolean,
    ) => {
      focusAndScrollImageAtIndex(imageIndex);
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        onToggleImageSelection(image.id, !isSelected);
        return;
      }
      onSelectImage(image);
    },
    [focusAndScrollImageAtIndex, onSelectImage, onToggleImageSelection],
  );

  const handleHoverPrefetch = useCallback((image: ImageRecord) => {
    if (!shouldPrefetch) return;
    const prefetchedImageUrls = prefetchedImageUrlsRef.current;
    const prefetchWidth =
      window.devicePixelRatio > 1.5
        ? NEXT_IMAGE_PREFETCH_WIDTH_HIDPI
        : NEXT_IMAGE_PREFETCH_WIDTH;
    const imageUrl = toNextImagePrefetchSrc(image.absolutePath, prefetchWidth);
    if (prefetchedImageUrls.has(imageUrl)) {
      return;
    }

    const preloadImage = new window.Image();
    preloadImage.decoding = "async";
    preloadImage.src = imageUrl;
    prefetchedImageUrls.add(imageUrl);
  }, [shouldPrefetch]);

  const handleKeyAction = useCallback(
    (key: string): boolean => {
      if (visibleImages.length === 0) return false;

      const currentIndex =
        clampedActiveImageIndex >= 0 ? clampedActiveImageIndex : 0;
      const verticalStep = Math.max(1, galleryColumns);

      if (key === " " || key === "Spacebar") {
        const activeImage = visibleImages[currentIndex];
        if (!activeImage) return false;
        onToggleImageSelection(
          activeImage.id,
          !selectedImageIds.has(activeImage.id),
        );
        focusAndScrollImageAtIndex(currentIndex);
        return true;
      }

      if (key === "Enter") {
        const activeImage = visibleImages[currentIndex];
        if (!activeImage) return false;
        onSelectImage(activeImage);
        focusAndScrollImageAtIndex(currentIndex);
        return true;
      }

      if (key === "Delete" || key === "Del") {
        const activeImage = visibleImages[currentIndex] ?? null;
        onDeleteKeyPressed(activeImage?.id ?? null);
        return true;
      }

      if (key === "ArrowLeft") {
        focusAndScrollImageAtIndex(currentIndex - 1);
        return true;
      }

      if (key === "ArrowRight") {
        focusAndScrollImageAtIndex(currentIndex + 1);
        return true;
      }

      if (key === "ArrowUp") {
        focusAndScrollImageAtIndex(currentIndex - verticalStep);
        return true;
      }

      if (key === "ArrowDown") {
        focusAndScrollImageAtIndex(currentIndex + verticalStep);
        return true;
      }

      if (key === "Home") {
        focusAndScrollImageAtIndex(0);
        return true;
      }

      if (key === "End") {
        focusAndScrollImageAtIndex(visibleImages.length - 1);
        return true;
      }

      return false;
    },
    [
      clampedActiveImageIndex,
      focusAndScrollImageAtIndex,
      galleryColumns,
      onDeleteKeyPressed,
      onSelectImage,
      onToggleImageSelection,
      selectedImageIds,
      visibleImages,
    ],
  );

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (visibleImages.length === 0) return;

      const target = event.target;
      const isImageButtonTarget =
        target instanceof HTMLElement &&
        target.dataset.galleryImageCard === "true";
      const isGridTarget = event.currentTarget === target;
      if (!isImageButtonTarget && !isGridTarget) return;
      if (handleKeyAction(event.key)) {
        event.preventDefault();
      }
    },
    [handleKeyAction, visibleImages.length],
  );

  useEffect(() => {
    if (isImageDetailsModalOpen) return;

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (visibleImages.length === 0) return;

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTypingTarget =
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        Boolean(target?.isContentEditable);
      if (isTypingTarget) return;

      if (handleKeyAction(event.key)) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    handleKeyAction,
    isImageDetailsModalOpen,
    visibleImages,
  ]);

  return (
    <>
      {!isLoading && !isScanActive && filteredImages.length === 0 ? (
        <EmptyState testId="gallery-empty-state" className="mt-6">
          No PNG images found for the current filters.
        </EmptyState>
      ) : !isLoading && filteredImages.length > 0 ? (
        <>
          <div className="sticky top-2 z-20 mt-4 flex justify-end sm:top-3">
            <div className="rounded-full border border-ui-border bg-ui-bg-card/95 px-3 py-1.5 text-ui-xs text-ui-ink-muted shadow-sm backdrop-blur">
              Selected: <span className="font-semibold text-ui-ink-title">{selectedImageCount}</span>{" "}
              image{selectedImageCount === 1 ? "" : "s"}
            </div>
          </div>
          {topSpacerHeight > 0 && (
            <div style={{ height: `${topSpacerHeight}px` }} aria-hidden="true" />
          )}
          <div
            id="gallery-grid"
            data-testid="gallery-grid"
            ref={galleryGridRef}
            tabIndex={0}
            onFocus={(event) => {
              if (event.target !== event.currentTarget) return;
              if (clampedActiveImageIndex >= 0) {
                const activeCard = imageCardRefs.current[clampedActiveImageIndex];
                activeCard?.scrollIntoView({
                  block: "nearest",
                  inline: "nearest",
                });
              }
            }}
            onKeyDown={handleGridKeyDown}
            className="gallery-grid mt-4 gap-2 rounded-xl focus-visible:outline-2 focus-visible:outline-[--ui-accent] focus-visible:outline-offset-2 sm:mt-6 sm:gap-4"
            style={galleryGridStyle}
            aria-label="Image gallery grid. Use arrow keys to navigate and space to toggle selection."
          >
            {canShowPreviousImages && (
              <div
                ref={loadPreviousSentinelRef}
                className="col-span-full h-px"
                aria-hidden="true"
              />
            )}
            {visibleImages.map((image, index) => {
              const isSelected = selectedImageIds.has(image.id);
              const isKeyboardActive = index === clampedActiveImageIndex;
              const imageIsFav = favouriteImageIds.has(image.id);
              return (
                <GalleryImageCardMemo
                  key={image.id}
                  image={image}
                  index={index}
                  isSelected={isSelected}
                  isKeyboardActive={isKeyboardActive}
                  isFavourite={imageIsFav}
                  imageSizes={imageSizes}
                  setCardRef={setCardRef}
                  onCardFocus={handleCardFocus}
                  onImageClick={handleImageClick}
                  onToggleImageSelection={onToggleImageSelection}
                  onToggleFavourite={collections?.toggleFavourite}
                  focusAndScrollImageAtIndex={focusAndScrollImageAtIndex}
                  onHoverPrefetch={handleHoverPrefetch}
                />
              );
            })}
            {canShowMoreImages && (
              <div ref={loadMoreSentinelRef} className="h-4 w-full" />
            )}
          </div>
        </>
      ) : null}

      {filteredImages.length > 0 && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <p className="text-ui-xs text-[--ui-ink-caption]">
            {windowStart > 0
              ? `Showing ${windowStart + 1}\u2013${windowStart + visibleImages.length} of ${filteredImages.length}`
              : `Showing ${Math.min(visibleImageCount, filteredImages.length)} of ${filteredImages.length}`}
          </p>
          {canShowMoreImages && (
            <OutlineButton
              onClick={onShowMoreImages}
              className="rounded-xl px-4 py-2 text-ui-sm"
            >
              Show more
            </OutlineButton>
          )}
        </div>
      )}
    </>
  );
}

