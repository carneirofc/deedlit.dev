"use client";

import { useState } from "react";
import Image from "next/image";
import {
  DockPanel,
  DropdownMenu,
  OutlineButton,
  SegmentedControl,
  TextInput,
  HeartIcon,
  FolderPlusIcon,
  XIcon,
  TrashIcon,
  CheckIcon,
  ChevronDownIcon,
  EditIcon,
} from "@deedlit.dev/ui";
import type { DropdownMenuItem } from "@deedlit.dev/ui";
import type { CollectionsHook } from "../hooks";

export type CollectionsDockTab = "favourites" | "groups";

type CollectionsDockProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  collections: CollectionsHook;
  onImageClick: (imageId: string) => void;
};

// ── SVG icon helpers (removed – using @deedlit.dev/ui icons) ─────────────

function toGalleryImageSrc(url: string): string {
  // If the URL already starts with /api/image, use it directly via next/image
  // Otherwise it's an absolute path already encoded
  return url;
}

// ── Favourites Tab ────────────────────────────────────────────────────

function FavouritesTab({
  collections,
  onImageClick,
}: {
  collections: CollectionsHook;
  onImageClick: (imageId: string) => void;
}) {
  const { favourites, toggleFavourite } = collections;

  if (favourites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <HeartIcon size="h-4 w-4" />
        <p className="text-ui-sm text-ui-ink-subtle">No favourites yet</p>
        <p className="text-ui-xs text-ui-ink-note">
          Click the heart icon on any image to add it here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {favourites.map((img) => (
        <div
          key={img.id}
          className="group relative overflow-hidden rounded-xl border border-ui-border bg-ui-bg-table"
        >
          <button
            type="button"
            onClick={() => onImageClick(img.id)}
            className="block aspect-square w-full cursor-zoom-in"
            title={`Open ${img.fileName}`}
          >
            <div className="relative h-full w-full">
              <Image
                src={toGalleryImageSrc(img.url)}
                alt={img.fileName}
                fill
                sizes="(max-width: 640px) 30vw, 120px"
                quality={85}
                className="object-contain"
              />
            </div>
          </button>
          <button
            type="button"
            onClick={() => toggleFavourite(img.id, "", img.fileName)}
            className="absolute right-1 top-1 z-10 grid h-6 w-6 place-items-center rounded-full bg-(--ui-bg-card)/90 text-rose-500 opacity-0 shadow-sm transition group-hover:opacity-100"
            aria-label={`Remove ${img.fileName} from favourites`}
            title="Remove from favourites"
          >
            <XIcon size="h-3 w-3" />
          </button>
          <p className="truncate px-1.5 py-1 text-ui-2xs text-ui-ink-note">
            {img.fileName}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Groups Tab ────────────────────────────────────────────────────────

function GroupsTab({
  collections,
  onImageClick,
}: {
  collections: CollectionsHook;
  onImageClick: (imageId: string) => void;
}) {
  const { groups, createGroup, deleteGroup, renameGroup, removeImageFromGroup } = collections;
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) return;
    const group = createGroup(newGroupName);
    setNewGroupName("");
    setExpandedGroupId(group.id);
  };

  return (
    <div className="space-y-3">
      {/* Create group form */}
      <div className="flex gap-2">
        <TextInput
          id="new-group-name"
          name="newGroupName"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="New group name"
          className="min-h-9 flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateGroup();
          }}
        />
        <OutlineButton
          onClick={handleCreateGroup}
          disabled={!newGroupName.trim()}
          controlSize="sm"
          className="shrink-0 gap-1"
        >
          <FolderPlusIcon size="h-4 w-4" />
          <span className="hidden sm:inline">Create</span>
        </OutlineButton>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <FolderPlusIcon size="h-4 w-4" />
          <p className="text-ui-sm text-ui-ink-subtle">No groups yet</p>
          <p className="text-ui-xs text-ui-ink-note">
            Create a group above, then add images from the gallery.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const isExpanded = expandedGroupId === group.id;
            const isEditing = editingGroupId === group.id;

            return (
              <div
                key={group.id}
                className="overflow-hidden rounded-xl border border-ui-border bg-ui-bg-card"
              >
                {/* Group header */}
                <div className="flex items-center gap-2 px-3 py-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: group.colour }}
                    aria-hidden="true"
                  />
                  {isEditing ? (
                    <TextInput
                      id={`edit-group-${group.id}`}
                      name="editGroupName"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="min-h-7 flex-1 text-ui-xs"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          renameGroup(group.id, editingName);
                          setEditingGroupId(null);
                        }
                        if (e.key === "Escape") {
                          setEditingGroupId(null);
                        }
                      }}
                      onBlur={() => {
                        renameGroup(group.id, editingName);
                        setEditingGroupId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="truncate text-ui-sm font-medium text-ui-ink-title">
                        {group.name}
                      </span>
                      <span className="shrink-0 text-ui-2xs text-ui-ink-note">
                        {group.images.length} image{group.images.length !== 1 ? "s" : ""}
                      </span>
                      <ChevronDownIcon
                        size="h-3.5 w-3.5"
                        className={`ml-auto shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingGroupId(group.id);
                      setEditingName(group.name);
                    }}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ui-ink-subtle transition hover:bg-ui-bg-soft"
                    aria-label={`Rename group "${group.name}"`}
                    title="Rename group"
                  >
                    <EditIcon size="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteGroup(group.id)}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-rose-500 transition hover:bg-rose-50"
                    aria-label={`Delete group "${group.name}"`}
                    title="Delete group"
                  >
                    <TrashIcon size="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Expanded image grid */}
                {isExpanded && (
                  <div className="border-t border-ui-border p-2">
                    {group.images.length === 0 ? (
                      <p className="py-3 text-center text-ui-xs text-ui-ink-note">
                        No images in this group yet.
                      </p>
                    ) : (
                      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                        {group.images.map((img) => (
                          <div
                            key={img.id}
                            className="group/img relative overflow-hidden rounded-lg border border-ui-border bg-ui-bg-table"
                          >
                            <button
                              type="button"
                              onClick={() => onImageClick(img.id)}
                              className="block aspect-square w-full cursor-zoom-in"
                              title={`Open ${img.fileName}`}
                            >
                              <div className="relative h-full w-full">
                                <Image
                                  src={toGalleryImageSrc(img.url)}
                                  alt={img.fileName}
                                  fill
                                  sizes="(max-width: 640px) 28vw, 100px"
                                  quality={85}
                                  className="object-contain"
                                />
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => removeImageFromGroup(group.id, img.id)}
                              className="absolute right-0.5 top-0.5 z-10 grid h-5 w-5 place-items-center rounded-full bg-(--ui-bg-card)/90 text-ui-ink-subtle opacity-0 shadow-sm transition group-hover/img:opacity-100"
                              aria-label={`Remove ${img.fileName} from group`}
                              title="Remove from group"
                            >
                              <XIcon size="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Add To Group Dropdown ─────────────────────────────────────────────

export type AddToGroupDropdownProps = {
  collections: CollectionsHook;
  imageId: string;
  absolutePath: string;
  fileName: string;
};

export function AddToGroupDropdown({
  collections,
  imageId,
  absolutePath,
  fileName,
}: AddToGroupDropdownProps) {
  const { groups, addImageToGroup, removeImageFromGroup } = collections;

  if (groups.length === 0) return null;

  const menuItems: DropdownMenuItem[] = groups.map((group) => {
    const isInGroup = group.images.some((img) => img.id === imageId);
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
          removeImageFromGroup(group.id, imageId);
        } else {
          addImageToGroup(group.id, imageId, absolutePath, fileName);
        }
      },
    };
  });

  return (
    <DropdownMenu
      trigger={
        <button
          type="button"
          className="grid h-7 w-7 place-items-center rounded-lg border border-ui-border bg-(--ui-bg-card)/90 text-ui-ink-subtle shadow-sm transition hover:bg-ui-bg-soft hover:text-ui-ink-strong"
          aria-label="Add to group"
          title="Add to group"
        >
          <FolderPlusIcon size="h-4 w-4" />
        </button>
      }
      items={menuItems}
      minWidth="min-w-40"
    />
  );
}

// ── Main Collections Dock ─────────────────────────────────────────────

export default function GalleryCollectionsDock({
  isOpen,
  onOpenChange,
  collections,
  onImageClick,
}: CollectionsDockProps) {
  const [activeTab, setActiveTab] = useState<CollectionsDockTab>("favourites");

  return (
    <DockPanel
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Collections"
      badgeCount={collections.favourites.length + collections.groups.length}
      openLabel="Open collections"
      closeLabel="Close collections"
      testIdPrefix="gallery-collections-dock"
      size="lg"
      toggleSlot={2}
      stackOrder={2}
      headerExtras={
        <div className="mt-2">
          <SegmentedControl
            value={activeTab}
            onValueChange={setActiveTab}
            className="grid w-full grid-cols-2 rounded-xl border border-ui-border-soft bg-panel/70 p-1"
            optionClassName="rounded-lg px-2 py-1 text-ui-xs"
            options={[
              { value: "favourites", label: `Favourites (${collections.favourites.length})` },
              { value: "groups", label: `Groups (${collections.groups.length})` },
            ]}
          />
        </div>
      }
    >
      {activeTab === "favourites" ? (
        <FavouritesTab collections={collections} onImageClick={onImageClick} />
      ) : (
        <GroupsTab collections={collections} onImageClick={onImageClick} />
      )}
    </DockPanel>
  );
}

