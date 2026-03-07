"use client";

import type { ReactNode } from "react";

import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { cn } from "./utils";

export type MediaStageProps = {
  children: ReactNode;
  hidden?: boolean;
  canNavigate?: boolean;
  onNavigate?: (direction: -1 | 1) => void;
  previousLabel?: string;
  nextLabel?: string;
  className?: string;
  viewportClassName?: string;
  previousOverlayClassName?: string;
  nextOverlayClassName?: string;
};

export default function MediaStage({
  children,
  hidden = false,
  canNavigate = false,
  onNavigate,
  previousLabel = "Previous item",
  nextLabel = "Next item",
  className,
  viewportClassName,
  previousOverlayClassName,
  nextOverlayClassName,
}: MediaStageProps) {
  if (hidden) return null;

  const showNavigation = canNavigate && typeof onNavigate === "function";

  return (
    <div className={cn("relative flex min-h-50 flex-col overflow-hidden bg-ui-bg-tint p-2 sm:min-h-75 sm:p-3 lg:p-4", className)}>
      <div className={cn("relative min-h-0 flex-1 overflow-hidden rounded-xl bg-panel", viewportClassName)}>
        {children}
        {showNavigation && (
          <>
            <button
              type="button"
              onClick={() => onNavigate(-1)}
              aria-label={previousLabel}
              className={cn(
                "group absolute inset-y-0 left-0 flex h-full w-1/3 cursor-pointer items-center justify-start pl-3 transition hover:bg-linear-to-r hover:from-black/25",
                previousOverlayClassName,
              )}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
                <ChevronLeftIcon size="h-5 w-5" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate(1)}
              aria-label={nextLabel}
              className={cn(
                "group absolute inset-y-0 right-0 flex h-full w-1/3 cursor-pointer items-center justify-end pr-3 transition hover:bg-linear-to-l hover:from-black/25",
                nextOverlayClassName,
              )}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
                <ChevronRightIcon size="h-5 w-5" />
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
