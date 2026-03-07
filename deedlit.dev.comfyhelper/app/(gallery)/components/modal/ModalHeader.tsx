"use client";

import {
  DropdownMenu,
  OutlineButton,
  ShuffleIcon,
  PauseIcon,
  PlayIcon,
  FolderIcon,
  DownloadIcon,
  DocumentPlusIcon,
  HeartIcon,
  FolderPlusIcon,
  CheckIcon,
  TrashIcon,
  XIcon,
} from "@deedlit.dev/ui";
import type { DropdownMenuItem } from "@deedlit.dev/ui";
import type { ImageRecord } from "@/lib/library-types";
import type { CollectionsHook } from "../../hooks";

type ModalHeaderProps = {
  image: ImageRecord;
  imageUrl: string;
  imageIndex: number;
  totalImages: number;
  isSlideshowMode: boolean;
  isDeletingImage: boolean;
  onRandomize: () => void;
  onToggleSlideshow: () => void;
  onDeleteImage: () => void;
  onDownload: () => void;
  onAddToNote?: () => void;
  onClose: () => void;
  collections?: CollectionsHook;
};

export default function ModalHeader({
  image,
  imageIndex,
  totalImages,
  isSlideshowMode,
  isDeletingImage,
  onRandomize,
  onToggleSlideshow,
  onDeleteImage,
  onDownload,
  onAddToNote,
  onClose,
  collections,
}: ModalHeaderProps) {
  const canNavigate = totalImages >= 2;
  const isFav = collections?.isFavourite(image.id) ?? false;
  const groupsForImage = collections?.getGroupsForImage(image.id) ?? [];

  const groupMenuItems: DropdownMenuItem[] = (collections?.groups ?? []).map((group) => {
    const isInGroup = group.images.some((img) => img.id === image.id);
    return {
      key: group.id,
      label: group.name,
      indicator: (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: group.colour }}
          aria-hidden="true"
        />
      ),
      trailing: isInGroup ? (
        <CheckIcon size="h-3.5 w-3.5" className="shrink-0 text-emerald-500" strokeWidth="2.5" />
      ) : undefined,
      onClick: () => {
        if (isInGroup) {
          collections!.removeImageFromGroup(group.id, image.id);
        } else {
          collections!.addImageToGroup(group.id, image.id, image.absolutePath, image.fileName);
        }
      },
    };
  });

  return (
    <div className="flex items-center justify-between gap-2 border-b border-ui-border px-3 py-2 sm:px-5 sm:py-3">
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-ui-sm font-semibold text-(--ui-ink-primary) sm:text-ui-lg">
          {image.fileName}
        </h3>
        <p className="hidden max-w-[75vw] truncate text-ui-sm text-ui-ink-subtle sm:block">
          {image.relativePath}
        </p>
        {imageIndex >= 0 && (
          <p className="mt-0.5 text-ui-2xs text-ui-ink-subtle sm:mt-1 sm:text-ui-xs">
            {imageIndex + 1} / {totalImages}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <OutlineButton
          type="button"
          onClick={onRandomize}
          disabled={!canNavigate}
          aria-label="Random image"
          controlSize="icon"
          className="border-ui-border-strong text-ui-ink-secondary hover:bg-ui-bg-soft"
        >
          <ShuffleIcon size="h-5 w-5" />
        </OutlineButton>
        <OutlineButton
          type="button"
          onClick={onToggleSlideshow}
          disabled={!canNavigate}
          aria-label={isSlideshowMode ? "Stop slideshow" : "Start slideshow"}
          controlSize="icon"
          className="border-ui-border-strong text-ui-ink-secondary hover:bg-ui-bg-soft"
        >
          {isSlideshowMode ? <PauseIcon size="h-5 w-5" /> : <PlayIcon size="h-5 w-5" />}
        </OutlineButton>
        <OutlineButton
          type="button"
          onClick={onDownload}
          aria-label={`Download ${image.fileName}`}
          disabled={isDeletingImage}
          controlSize="icon"
        >
          <DownloadIcon size="h-5 w-5" />
        </OutlineButton>
        {onAddToNote && (
          <OutlineButton
            type="button"
            onClick={onAddToNote}
            aria-label="Add to prompt note"
            controlSize="icon"
          >
            <DocumentPlusIcon size="h-5 w-5" />
          </OutlineButton>
        )}
        {/* Favourite toggle */}
        {collections && (
          <OutlineButton
            type="button"
            onClick={() => collections.toggleFavourite(image.id, image.absolutePath, image.fileName)}
            aria-label={isFav ? "Remove from favourites" : "Add to favourites"}
            controlSize="icon"
            className={isFav ? "text-rose-500" : undefined}
          >
            <HeartIcon filled={isFav} size="h-5 w-5" />
          </OutlineButton>
        )}
        {/* Add to group dropdown */}
        {collections && groupMenuItems.length > 0 && (
          <DropdownMenu
            trigger={
              <OutlineButton
                type="button"
                aria-label="Add to group"
                controlSize="icon"
              >
                <FolderPlusIcon size="h-5 w-5" />
              </OutlineButton>
            }
            items={groupMenuItems}
            minWidth="min-w-45"
          />
        )}
        {/* Group indicators */}
        {groupsForImage.length > 0 && (
          <div className="hidden items-center gap-0.5 sm:flex">
            {groupsForImage.slice(0, 3).map((g) => (
              <span
                key={g.id}
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: g.colour }}
                title={g.name}
              />
            ))}
          </div>
        )}
        <OutlineButton
          type="button"
          onClick={onDeleteImage}
          disabled={isDeletingImage }
          aria-label={isDeletingImage ? `Moving ${image.fileName} to trash` : `Move ${image.fileName} to trash`}
          controlSize="icon"
          variant="danger"
        >
          <TrashIcon size="h-5 w-5" />
        </OutlineButton>
        <OutlineButton
          type="button"
          onClick={onClose}
          aria-label="Close"
          controlSize="icon"
        >
          <XIcon size="h-5 w-5" />
        </OutlineButton>
      </div>
    </div>
  );
}

