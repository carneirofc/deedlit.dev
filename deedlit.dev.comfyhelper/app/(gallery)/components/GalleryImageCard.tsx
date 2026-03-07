import {
  type MouseEvent,
} from "react";
import Image from "next/image";
import { ImageRecord } from "@/lib/library-types";
import { cn } from "@/lib/utils";
import { CheckIcon, HeartIcon, OutlineButton, Checkbox } from "@deedlit.dev/ui";
import { toGalleryImageSrc } from "@/lib/image-utils";

type GalleryImageCardProps = {
  image: ImageRecord;
  index: number;
  isSelected: boolean;
  isKeyboardActive: boolean;
  isFavourite: boolean;
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
      aria-selected={isSelected}
      tabIndex={-1}
      onFocus={() => onCardFocus(index)}
      onMouseEnter={() => onHoverPrefetch(image)}
      className={cn(
        `group overflow-hidden rounded-2xl border border-transparent bg-panel/92 shadow-[--ui-shadow-card] transition-[border-color,box-shadow,transform] duration-150 [contain-intrinsic-size:360px] [content-visibility:auto],
        `,
        isSelected
          ? "border-(--ui-accent) shadow-[0_0_0_1px_var(--ui-accent),var(--ui-shadow-card)] ring-4 ring-(--ui-accent) ring-offset-2 ring-offset-ui-bg"
          : "",
        isKeyboardActive
          ? " outline-2 outline-(--ui-accent) outline-offset-2"
          : "",
      )}
    >
      <div className="relative">
        {isSelected ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 bg-(--ui-accent)/12 shadow-[inset_0_0_0_2px_var(--ui-accent)]"
          />
        ) : null}
        <Checkbox
          title="Select image for bulk actions"
          checked={isSelected}
          className={
            cn(
              `absolute left-2 top-2 z-10
                flex cursor-pointer rounded-full border border-slate-200/80 bg-white/92 px-2 py-1 shadow-md backdrop-blur-sm transition-opacity`,
              isSelected || isKeyboardActive
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100")}

          onChange={(event) => {
            onToggleImageSelection(image.id, event.target.checked);
            focusAndScrollImageAtIndex(index);
          }}
        />
        {isSelected ? (
          <div className="pointer-events-none absolute left-12 top-2 z-20 inline-flex items-center gap-1 rounded-full border border-(--ui-accent)/35 bg-(--ui-bg-card)/96 px-2.5 py-1 text-ui-xs font-semibold text-(--ui-accent) shadow-md backdrop-blur-sm">
            <CheckIcon className="h-3.5 w-3.5" />
            <span>Selected</span>
          </div>
        ) : null}
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
