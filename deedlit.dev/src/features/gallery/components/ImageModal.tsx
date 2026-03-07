"use client";

import { useEffect } from "react";
import Image from "next/image";
import { FiX } from "react-icons/fi";
import { DownloadIcon, OutlineButton } from "@deedlit.dev/ui";
import type { ImageAsset } from "@/features/gallery/types";

interface ImageModalProps {
  asset: ImageAsset | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ImageModal({ asset, isOpen, onClose }: ImageModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen || !asset) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${asset.title} details`}
      onClick={onClose}
    >
      <div
        className="relative max-h-[94vh] w-full max-w-5xl overflow-hidden rounded-xl2 border border-line/70 bg-surface shadow-soft"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="absolute right-3 top-3 z-10 flex flex-wrap gap-2">
          <a
            href={asset.src}
            download={`image-${asset.id}`}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-line/80 bg-base/85 px-3 py-1 text-xs text-muted hover:text-text"
          >
            <DownloadIcon size="h-3.5 w-3.5" aria-hidden />
            Download
          </a>
          <OutlineButton
            type="button"
            controlSize="sm"
            onClick={onClose}
            aria-label="Close image modal"
          >
            <FiX className="h-3.5 w-3.5" />
            Close
          </OutlineButton>
        </div>

        <div className="relative overflow-auto bg-base/70 p-3">
          <div className="relative mx-auto h-[75vh] w-full max-w-5xl">
            <Image
              src={asset.src}
              alt={asset.title}
              fill
              sizes="(max-width: 1024px) 100vw, 90vw"
              className="rounded-lg object-contain"
              priority
            />
          </div>
        </div>
      </div>
    </div>
  );
}

