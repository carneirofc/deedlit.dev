"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Minimum card width expressed in rem so it scales with the user's font-size preference. */
const MIN_GALLERY_CARD_WIDTH_REM = 16; // 256px at the default 16px root font size — keeps phones at 1 column
/** Approximate row height in rem used to size the top spacer when items are trimmed off the top. */
const ESTIMATED_ROW_HEIGHT_REM = 18.75; // ~300px at the default 16px root font size
/** Below this width, prefer automatic clamping so phones and narrow tablets do not get unusably tiny tiles. */
const NARROW_LAYOUT_BREAKPOINT_PX = 768;

function remToPx(rem: number): number {
  if (typeof document === "undefined") return rem * 16;
  return rem * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

export type GalleryGridState = {
  galleryGridRef: React.RefObject<HTMLDivElement | null>;
  loadMoreSentinelRef: React.RefObject<HTMLDivElement | null>;
  loadPreviousSentinelRef: React.RefObject<HTMLDivElement | null>;
  topSpacerHeight: number;
  effectiveGalleryColumns: number;
  galleryGridStyle: CSSProperties;
};

export function useGalleryGrid(
  galleryColumns: number,
  isGridMounted: boolean,
  canShowMoreImages: boolean,
  canShowPreviousImages: boolean,
  windowStart: number,
  slideWindowDown: () => void,
  slideWindowUp: () => void,
): GalleryGridState {
  const galleryGridRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadPreviousSentinelRef = useRef<HTMLDivElement | null>(null);
  // Seed with window.innerWidth so the very first render already uses a sensible
  // column count on mobile instead of jumping from the configured max down to 1.
  const [galleryContainerWidth, setGalleryContainerWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return window.innerWidth;
  });
  const [rowPitch, setRowPitch] = useState<number>(() => remToPx(ESTIMATED_ROW_HEIGHT_REM));
  const topSentinelWasIntersectingRef = useRef(false);
  const topSlideInFlightRef = useRef(false);
  const pendingAnchorRef = useRef<{ element: HTMLElement; top: number } | null>(null);

  const effectiveGalleryColumns = useMemo(() => {
    const configured = Math.max(1, Math.min(galleryColumns, 12));
    if (galleryContainerWidth <= 0) return configured;

    // The configured column count is intended to control the desktop gallery layout.
    // Only clamp aggressively on narrower layouts where fixed desktop counts would
    // collapse tiles into unreadably small cells.
    if (galleryContainerWidth >= NARROW_LAYOUT_BREAKPOINT_PX) {
      return configured;
    }

    const minCardWidthPx = remToPx(MIN_GALLERY_CARD_WIDTH_REM);
    const maxByWidth = Math.max(1, Math.floor(galleryContainerWidth / minCardWidthPx));
    return Math.min(configured, maxByWidth);
  }, [galleryColumns, galleryContainerWidth]);

  const galleryGridStyle = useMemo(() => {
    return {
      gridTemplateColumns: `repeat(${effectiveGalleryColumns}, minmax(0, 1fr))`,
    } as CSSProperties;
  }, [effectiveGalleryColumns]);

  const measureRowPitch = useCallback(() => {
    const gridNode = galleryGridRef.current;
    if (!gridNode) return;

    const cardNodes = gridNode.querySelectorAll<HTMLElement>("[data-gallery-image-card='true']");
    if (cardNodes.length === 0) return;

    const computed = window.getComputedStyle(gridNode);
    const parsedRowGap = Number.parseFloat(computed.rowGap || "0");
    const rowGap = Number.isFinite(parsedRowGap) ? parsedRowGap : 0;
    let nextPitch = cardNodes[0].getBoundingClientRect().height + rowGap;

    if (effectiveGalleryColumns > 1 && cardNodes.length > effectiveGalleryColumns) {
      const firstRowTop = cardNodes[0].getBoundingClientRect().top;
      const secondRowTop = cardNodes[effectiveGalleryColumns].getBoundingClientRect().top;
      const measuredPitch = secondRowTop - firstRowTop;
      if (measuredPitch > 0) {
        nextPitch = measuredPitch;
      }
    }

    if (!Number.isFinite(nextPitch) || nextPitch <= 0) return;

    setRowPitch((current) => {
      if (Math.abs(current - nextPitch) < 0.5) {
        return current;
      }
      return nextPitch;
    });
  }, [effectiveGalleryColumns]);

  const topSpacerHeight = useMemo(() => {
    if (windowStart <= 0 || effectiveGalleryColumns <= 0) return 0;
    const removedRows = Math.ceil(windowStart / effectiveGalleryColumns);
    return removedRows * rowPitch;
  }, [windowStart, effectiveGalleryColumns, rowPitch]);

  const captureScrollAnchor = useCallback(() => {
    const gridNode = galleryGridRef.current;
    if (!gridNode) return null;

    const cards = gridNode.querySelectorAll<HTMLElement>("[data-gallery-image-card='true']");
    if (cards.length === 0) return null;

    const firstVisibleCard = Array.from(cards).find((card) => {
      const rect = card.getBoundingClientRect();
      return rect.bottom > 0;
    });
    const anchorElement = firstVisibleCard ?? cards[0];
    return {
      element: anchorElement,
      top: anchorElement.getBoundingClientRect().top,
    };
  }, []);

  // Bottom sentinel: load more images downward
  useEffect(() => {
    if (!canShowMoreImages) return;
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        slideWindowDown();
      },
      { rootMargin: "260px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canShowMoreImages, slideWindowDown]);

  // Top sentinel: load previous images upward
  useEffect(() => {
    if (!canShowPreviousImages) {
      topSentinelWasIntersectingRef.current = false;
      topSlideInFlightRef.current = false;
      pendingAnchorRef.current = null;
      return;
    }
    const sentinel = loadPreviousSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (!entry.isIntersecting) {
          topSentinelWasIntersectingRef.current = false;
          return;
        }
        if (topSentinelWasIntersectingRef.current || topSlideInFlightRef.current) return;
        topSentinelWasIntersectingRef.current = true;
        topSlideInFlightRef.current = true;
        pendingAnchorRef.current = captureScrollAnchor();
        slideWindowUp();
      },
      { rootMargin: "140px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canShowPreviousImages, captureScrollAnchor, slideWindowUp]);

  // After prepending images at the top, keep the viewport anchored to avoid jumpy upward scrolling.
  useEffect(() => {
    if (!topSlideInFlightRef.current) return;

    const frameId = window.requestAnimationFrame(() => {
      const pendingAnchor = pendingAnchorRef.current;

      if (pendingAnchor?.element.isConnected) {
        const currentTop = pendingAnchor.element.getBoundingClientRect().top;
        const delta = currentTop - pendingAnchor.top;
        if (Math.abs(delta) > 1) {
          window.scrollBy({ top: delta, behavior: "auto" });
        }
      }

      topSlideInFlightRef.current = false;
      pendingAnchorRef.current = null;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [windowStart]);

  // Container width observer
  useEffect(() => {
    if (!isGridMounted) return;

    const gridNode = galleryGridRef.current;
    if (!gridNode) return;

    const syncWidth = () => setGalleryContainerWidth(gridNode.clientWidth);
    syncWidth();

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? gridNode.clientWidth;
      setGalleryContainerWidth(width);
    });

    observer.observe(gridNode);
    return () => observer.disconnect();
  }, [isGridMounted]);

  useEffect(() => {
    measureRowPitch();
  }, [measureRowPitch, galleryContainerWidth, windowStart]);

  return {
    galleryGridRef,
    loadMoreSentinelRef,
    loadPreviousSentinelRef,
    topSpacerHeight,
    effectiveGalleryColumns,
    galleryGridStyle,
  };
}
