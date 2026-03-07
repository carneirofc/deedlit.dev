import Image from "next/image";
import type { ImageAsset } from "@/features/gallery/types";

interface GalleryCardProps {
  asset: ImageAsset;
  onView: () => void;
}

export function GalleryCard({ asset, onView }: GalleryCardProps) {
  return (
    <article className="group rounded-xl2 bg-surface/75 p-3 shadow-soft">
      <div className="relative overflow-hidden rounded-lg">
        <button
          type="button"
          onClick={onView}
          className="focus-ring block w-full text-left"
          aria-label={`Open image ${asset.title}`}
        >
          <div className="relative aspect-[3/4]">
            <Image
              src={asset.src}
              alt={asset.title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
              className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          </div>
        </button>
      </div>

      <div className="mt-3">
        <a
          href={asset.referenceHref}
          className="focus-ring text-sm font-medium text-muted transition hover:text-text"
        >
          {asset.title}
        </a>
      </div>
    </article>
  );
}
