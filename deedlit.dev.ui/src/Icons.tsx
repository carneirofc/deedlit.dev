"use client";

import { forwardRef, type SVGAttributes } from "react";

import { cn } from "./utils";

// ── Base icon props ──────────────────────────────────────────────────

export type IconProps = SVGAttributes<SVGSVGElement> & {
  /** Override the default 24×24 size class. */
  size?: string;
};

const BASE_ICON_CLASSES = "shrink-0 fill-none stroke-current";
const DEFAULT_SIZE = "h-4 w-4";

function icon(
  displayName: string,
  paths: (props: IconProps) => React.ReactNode,
) {
  const Component = forwardRef<SVGSVGElement, IconProps>(
    function IconComponent({ size, className, ...props }, ref) {
      return (
        <svg
          ref={ref}
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={cn(BASE_ICON_CLASSES, size ?? DEFAULT_SIZE, className)}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          {...props}
        >
          {paths(props)}
        </svg>
      );
    },
  );
  Component.displayName = displayName;
  return Component;
}

// ── Icons ────────────────────────────────────────────────────────────

export const HeartIcon = forwardRef<SVGSVGElement, IconProps & { filled?: boolean }>(
  function HeartIcon({ filled, size, className, ...props }, ref) {
    return (
      <svg
        ref={ref}
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={cn(BASE_ICON_CLASSES, size ?? DEFAULT_SIZE, className)}
        fill={filled ? "currentColor" : "none"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    );
  },
);
HeartIcon.displayName = "HeartIcon";

export const XIcon = icon("XIcon", () => (
  <>
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </>
));

export const TrashIcon = icon("TrashIcon", () => (
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </>
));

export const FolderIcon = icon("FolderIcon", () => (
  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
));

export const FolderPlusIcon = icon("FolderPlusIcon", () => (
  <>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 11v6" />
    <path d="M9 14h6" />
  </>
));

export const DownloadIcon = icon("DownloadIcon", () => (
  <>
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M4 21h16" />
  </>
));

export const CopyIcon = icon("CopyIcon", () => (
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>
));

export const PlusIcon = icon("PlusIcon", () => (
  <path d="M12 5v14M5 12h14" />
));

export const CheckIcon = icon("CheckIcon", () => (
  <path d="M20 6L9 17l-5-5" />
));

export const ChevronDownIcon = icon("ChevronDownIcon", () => (
  <path d="M6 9l6 6 6-6" />
));

export const ChevronLeftIcon = icon("ChevronLeftIcon", () => (
  <path d="M15 18l-6-6 6-6" />
));

export const ChevronRightIcon = icon("ChevronRightIcon", () => (
  <path d="M9 18l6-6-6-6" />
));

export const DocumentIcon = icon("DocumentIcon", () => (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </>
));

export const DocumentPlusIcon = icon("DocumentPlusIcon", () => (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M12 18v-6" />
    <path d="M9 15h6" />
  </>
));

export const ShuffleIcon = icon("ShuffleIcon", () => (
  <>
    <path d="M16 3h5v5" />
    <path d="M4 20L21 3" />
    <path d="M21 16v5h-5" />
    <path d="M15 15l6 6" />
    <path d="M4 4l5 5" />
  </>
));

export const PlayIcon = icon("PlayIcon", () => (
  <path d="M8 5v14l11-7z" />
));

export const PauseIcon = icon("PauseIcon", () => (
  <>
    <path d="M10 5v14" />
    <path d="M14 5v14" />
  </>
));

export const EditIcon = icon("EditIcon", () => (
  <>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </>
));
