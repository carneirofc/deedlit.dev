"use client";

import Image from "next/image";
import { MediaStage } from "@deedlit.dev/ui";

type ImagePreviewPanelProps = {
  imageUrl: string;
  fileName: string;
  hidden: boolean;
  onNavigate?: (direction: -1 | 1) => void;
  canNavigate?: boolean;
  className?: string;
};

export default function ImagePreviewPanel({ imageUrl, fileName, hidden, onNavigate, canNavigate, className }: ImagePreviewPanelProps) {
  return (
    <MediaStage
      hidden={hidden}
      canNavigate={canNavigate}
      onNavigate={onNavigate}
      previousLabel="Previous image"
      nextLabel="Next image"
      className={className}
    >
      <Image
        src={imageUrl}
        alt={fileName}
        fill
        sizes="(min-width: 1280px) 62vw, (min-width: 1024px) 58vw, 100vw"
        quality={95}
        className="object-contain object-center"
      />
    </MediaStage>
  );
}

