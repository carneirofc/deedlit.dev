import { ImageGroup } from "@/lib/collections-store";
import {
  type MouseEvent,
} from "react";
import Image from "next/image";
import { ImageRecord } from "@/lib/library-types";
import { cn } from "@/lib/utils";
import { HeartIcon, OutlineButton, Checkbox } from "@deedlit.dev/ui";
import { toGalleryImageSrc, toNextImagePrefetchSrc } from "@/lib/image-utils";

type GalleryImageCardProps = {
  image: ImageRecord;
  index: number;
  isSelected: boolean;
  isKeyboardActive: boolean;
  isFavourite: boolean;
  groupsForImage: ImageGroup[];
  imageSizes: string;
  setCardRef: (index: number, node: HTMLElement | null) => void;
  onCardFocus: (index: number) => void;
  onImageClick: (
    event: MouseEvent<HTMLButtonElement>,
    image: ImageRecord,
    imageIndex: number,
    isSelected: boolean,
  ) => void;
  onToggleImageSelection: (imageId: string, isSelected: boolean) => void;
  onToggleFavourite?: (imageId: string, absolutePath: string, fileName: string) => void;
  focusAndScrollImageAtIndex: (index: number) => void;
  onHoverPrefetch: (image: ImageRecord) => void;
};

export function GalleryImageCard({
  image,
  index,
  isSelected,
  isKeyboardActive,
  isFavourite,
  groupsForImage,
  imageSizes,
  setCardRef,
  onCardFocus,
  onImageClick,
  onToggleImageSelection,
  onToggleFavourite,
  focusAndScrollImageAtIndex,
  onHoverPrefetch,
}: GalleryImageCardProps) {
  return (
    <article
      ref={(node) => {
        setCardRef(index, node);
      }}
      data-gallery-image-card="true"
      tabIndex={-1}
      onFocus={() => onCardFocus(index)}
      onMouseEnter={() => onHoverPrefetch(image)}
      className={cn(
        `group overflow-hidden rounded-2xl bg-panel/92 shadow-[--ui-shadow-card] [contain-intrinsic-size:360px] [content-visibility:auto],
        `,
        isSelected
          ? " ring-2 ring-(--ui-accent) ring-offset-2 ring-offset-ui-bg"
          : "",
        isKeyboardActive
          ? " outline-2 outline-(--ui-accent) outline-offset-2"
          : "",
      )}
    >
      <div className="relative">
        <Checkbox
          title="Select image for bulk actions"
          checked={isSelected}
          className={
            cn(
              `absolute left-2 top-2 z-10
                flex cursor-pointer
                px-2 py-1`,
              isSelected || isKeyboardActive
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100")}

          onChange={(event) => {
            onToggleImageSelection(image.id, event.target.checked);
            focusAndScrollImageAtIndex(index);
          }}
        />
        {onToggleFavourite && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavourite(image.id, image.absolutePath, image.fileName);
            }}
            className={cn(
              "absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full border shadow-md transition-all cursor-pointer hover:scale-110 backdrop-blur-sm",
              isFavourite
                ? "border-rose-300 bg-rose-100 text-rose-500 hover:bg-rose-100 hover:border-rose-400"
                : "border-slate-300/80 bg-white/95 text-slate-600 shadow-slate-900/20 hover:bg-white hover:text-rose-500 hover:border-rose-300 hover:shadow-rose-500/20",
            )}
            aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
            title={isFavourite ? "Remove from favourites" : "Add to favourites"}
          >
            <HeartIcon filled={isFavourite} size="h-3.5 w-3.5" />
          </button>
        )}
        <OutlineButton
          tabIndex={-1}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={(event) => onImageClick(event, image, index, isSelected)}
          className="block w-full cursor-zoom-in border-0 bg-transparent p-0 font-normal hover:bg-transparent"
          title="Open details. Use Ctrl/Cmd+Click or Space to toggle selection. Arrow keys navigate while grid is focused."
        >
          <div className="relative aspect-square w-full bg-[--ui-bg-table]">
            <Image
              src={toGalleryImageSrc(image.absolutePath)}
              alt={image.fileName}
              fill
              sizes={imageSizes}
              quality={90}
              loading="lazy"
              decoding="async"
              className="object-contain"
            />
          </div>
        </OutlineButton>
      </div>
    </article>
  );
}
