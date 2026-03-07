"use client";

import { PageHeader } from "@deedlit.dev/ui";

type GalleryHeaderControlsProps = {
  className?: string;
};

export default function GalleryHeaderControls({ className }: GalleryHeaderControlsProps) {
  return (
    <PageHeader
      testId="gallery-header"
      subtitle="deedlit.dev // gallery"
      title="Image Results"
      titleTag="h2"
      description="Browse, filter, and inspect generated images with metadata."
      className={className}
    />
  );
}



