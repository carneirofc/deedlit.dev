"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import {
  LuChevronDown,
  LuFolder,
  LuFolderPlus,
  LuHeart,
  LuPencil,
  LuTrash2,
  LuX,
} from "react-icons/lu";

import {
  CyberPanel,
  CyberSubpanel,
  ConfirmationDialog,
  EmptyState,
  OutlineButton,
  PageHeader,
  SegmentedControl,
  TextInput,
  InfoChip,
} from "@deedlit.dev/ui";
import type { ConfirmationDialogData } from "@deedlit.dev/ui";
import type { ImageRecord } from "@/lib/library-types";
import { useLibraryQuery } from "@/lib/queries/use-library";
import StandaloneImageModal from "@/components/StandaloneImageModal";
import {
  type CollectionImage,
  type ImageGroup,
  loadFavourites,
  saveFavourites,
  removeFavourite,
  loadGroups,
  createGroup,
  deleteGroup,
  renameGroup,
  removeImageFromGroup,
} from "@/lib/collections-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "favourites" | "groups";

type SortMode = "newest" | "oldest" | "name";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortImages(images: CollectionImage[], mode: SortMode): CollectionImage[] {
  const copy = [...images];
  switch (mode) {
    case "newest":
      return copy.sort((a, b) => b.addedAt - a.addedAt);
    case "oldest":
      return copy.sort((a, b) => a.addedAt - b.addedAt);
    case "name":
      return copy.sort((a, b) => a.fileName.localeCompare(b.fileName));
    default:
      return copy;
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Favourites Tab
// ---------------------------------------------------------------------------

function FavouritesSection({
  favourites,
  onRemove,
  onClearAll,
  onImageClick,
}: {
  favourites: CollectionImage[];
  onRemove: (imageId: string) => void;
  onClearAll: () => void;
  onImageClick: (imageId: string) => void;
}) {
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [search, setSearch] = useState("");

  const filtered = sortImages(
    search
      ? favourites.filter((img) => img.fileName.toLowerCase().includes(search.toLowerCase()))
      : favourites,
    sortMode,
  );

  if (favourites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <LuHeart className="h-10 w-10 text-ui-ink-subtle" />
        <EmptyState>
          No favourites yet. Click the heart icon on any image in the gallery to add it here.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          id="fav-search"
          name="favSearch"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search favourites..."
          className="min-h-9 w-full sm:w-64"
        />
        <SegmentedControl
          value={sortMode}
          onValueChange={setSortMode}
          className="rounded-xl border border-ui-border-soft bg-panel/70 p-1"
          optionClassName="rounded-lg px-2.5 py-1 text-ui-xs"
          options={[
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
            { value: "name", label: "Name" },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <InfoChip>Total: {favourites.length}</InfoChip>
          <OutlineButton
            onClick={onClearAll}
            controlSize="sm"
            variant="danger"
            className="gap-1.5"
          >
            <LuTrash2 className="h-3.5 w-3.5" />
            Clear All
          </OutlineButton>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState tone="subtle">No favourites match your search.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filtered.map((img) => (
            <div
              key={img.id}
              className="group relative overflow-hidden rounded-2xl border border-ui-border bg-ui-bg-table transition hover:shadow-panel-sm"
            >
              <button
                type="button"
                onClick={() => onImageClick(img.id)}
                className="relative block aspect-square w-full cursor-pointer"
                aria-label={`View ${img.fileName}`}
                title={img.fileName}
              >
                <Image
                  src={img.url}
                  alt={img.fileName}
                  fill
                  sizes="(max-width: 640px) 45vw, (max-width: 1024px) 25vw, 180px"
                  quality={60}
                  className="object-contain"
                />
              </button>
              <button
                type="button"
                onClick={() => onRemove(img.id)}
                className="absolute right-1.5 top-1.5 z-10 grid h-7 w-7 place-items-center rounded-full bg-(--ui-bg-card)/90 text-rose-500 opacity-0 shadow-sm transition group-hover:opacity-100"
                aria-label={`Remove ${img.fileName} from favourites`}
                title="Remove from favourites"
              >
                <LuX className="h-3.5 w-3.5" />
              </button>
              <div className="px-2 py-1.5">
                <p className="truncate text-ui-xs font-medium text-ui-ink-title">
                  {img.fileName}
                </p>
                <p className="text-ui-2xs text-ui-ink-note">
                  {formatDate(img.addedAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group Card
// ---------------------------------------------------------------------------

function GroupCard({
  group,
  onDelete,
  onRename,
  onRemoveImage,
  onImageClick,
}: {
  group: ImageGroup;
  onDelete: () => void;
  onRename: (name: string) => void;
  onRemoveImage: (imageId: string) => void;
  onImageClick: (imageId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);

  const commitRename = () => {
    if (editName.trim()) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  return (
    <CyberSubpanel className="overflow-hidden rounded-2xl p-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className="h-4 w-4 shrink-0 rounded-full"
          style={{ backgroundColor: group.colour }}
          aria-hidden="true"
        />

        {isEditing ? (
          <TextInput
            id={`edit-group-${group.id}`}
            name="editGroupName"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="min-h-8 flex-1 text-ui-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setIsEditing(false);
            }}
            onBlur={commitRename}
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="truncate text-ui-sm font-semibold text-ui-ink-title">
              {group.name}
            </span>
            <span className="shrink-0 rounded-full bg-ui-bg-muted px-2 py-0.5 text-ui-2xs text-ui-ink-note">
              {group.images.length} image{group.images.length !== 1 ? "s" : ""}
            </span>
            <LuChevronDown
              className={`ml-auto h-4 w-4 shrink-0 text-ui-ink-subtle transition-transform ${isExpanded ? "rotate-180" : ""}`}
            />
          </button>
        )}

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setEditName(group.name);
              setIsEditing(true);
            }}
            className="grid h-7 w-7 place-items-center rounded-lg text-ui-ink-subtle transition hover:bg-ui-bg-soft hover:text-ui-ink-title"
            aria-label={`Rename group "${group.name}"`}
            title="Rename group"
          >
            <LuPencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="grid h-7 w-7 place-items-center rounded-lg text-rose-500 transition hover:bg-rose-500/10"
            aria-label={`Delete group "${group.name}"`}
            title="Delete group"
          >
            <LuTrash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 border-t border-ui-border px-4 py-2 text-ui-2xs text-ui-ink-note">
        <span>Created {formatDate(group.createdAt)}</span>
        <span className="text-ui-border">|</span>
        <span>Updated {formatDate(group.updatedAt)}</span>
      </div>

      {/* Expanded image grid */}
      {isExpanded && (
        <div className="border-t border-ui-border p-3">
          {group.images.length === 0 ? (
            <EmptyState tone="subtle" className="py-6 text-center">
              No images in this group. Add images from the gallery.
            </EmptyState>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {group.images.map((img) => (
                <div
                  key={img.id}
                  className="group/img relative overflow-hidden rounded-xl border border-ui-border bg-ui-bg-table"
                >
                  <button
                    type="button"
                    onClick={() => onImageClick(img.id)}
                    className="relative block aspect-square w-full cursor-pointer"
                    aria-label={`View ${img.fileName}`}
                    title={img.fileName}
                  >
                    <Image
                      src={img.url}
                      alt={img.fileName}
                      fill
                      sizes="(max-width: 640px) 30vw, 120px"
                      quality={50}
                      className="object-contain"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveImage(img.id)}
                    className="absolute right-1 top-1 z-10 grid h-6 w-6 place-items-center rounded-full bg-(--ui-bg-card)/90 text-ui-ink-subtle opacity-0 shadow-sm transition group-hover/img:opacity-100"
                    aria-label={`Remove ${img.fileName} from group`}
                    title="Remove from group"
                  >
                    <LuX className="h-3 w-3" />
                  </button>
                  <p className="truncate px-1.5 py-1 text-ui-2xs text-ui-ink-note">
                    {img.fileName}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </CyberSubpanel>
  );
}

// ---------------------------------------------------------------------------
// Groups Tab
// ---------------------------------------------------------------------------

function GroupsSection({
  groups,
  onCreateGroup,
  onDeleteGroup,
  onRenameGroup,
  onRemoveImage,
  onImageClick,
}: {
  groups: ImageGroup[];
  onCreateGroup: (name: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onRemoveImage: (groupId: string, imageId: string) => void;
  onImageClick: (imageId: string) => void;
}) {
  const [newGroupName, setNewGroupName] = useState("");

  const handleCreate = () => {
    if (!newGroupName.trim()) return;
    onCreateGroup(newGroupName.trim());
    setNewGroupName("");
  };

  return (
    <div className="space-y-4">
      {/* Create group form */}
      <div className="flex gap-3">
        <TextInput
          id="new-group-name"
          name="newGroupName"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="New group name..."
          className="min-h-10 flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
        />
        <OutlineButton
          onClick={handleCreate}
          disabled={!newGroupName.trim()}
          controlSize="md"
          className="shrink-0 gap-1.5"
        >
          <LuFolderPlus className="h-4 w-4" />
          Create Group
        </OutlineButton>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-3">
        <InfoChip>Groups: {groups.length}</InfoChip>
        <InfoChip>Total images: {groups.reduce((sum, g) => sum + g.images.length, 0)}</InfoChip>
      </div>

      {/* Group list */}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <LuFolder className="h-10 w-10 text-ui-ink-subtle" />
          <EmptyState>
            No groups yet. Create your first group above, then add images from the gallery.
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              onDelete={() => onDeleteGroup(group.id)}
              onRename={(name) => onRenameGroup(group.id, name)}
              onRemoveImage={(imageId) => onRemoveImage(group.id, imageId)}
              onImageClick={onImageClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function CollectionsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("favourites");
  const [favourites, setFavourites] = useState<CollectionImage[]>(() => loadFavourites());
  const [groups, setGroups] = useState<ImageGroup[]>(() => loadGroups());
  const [confirmation, setConfirmation] = useState<ConfirmationDialogData | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);

  const { data: libraryData } = useLibraryQuery();

  const handleImageClick = useCallback(
    (imageId: string) => {
      const record = libraryData?.images?.find((img) => img.id === imageId) ?? null;
      setSelectedImage(record);
    },
    [libraryData?.images],
  );

  // -- Favourites actions --
  const handleRemoveFavourite = useCallback((imageId: string) => {
    setFavourites((prev) => removeFavourite(prev, imageId));
  }, []);

  const handleClearAllFavourites = useCallback(() => {
    setConfirmation({
      title: "Clear All Favourites",
      details: [`You have ${favourites.length} favourite(s).`],
      outcomes: ["All favourites will be permanently removed."],
      confirmLabel: "Clear All",
      cancelLabel: "Cancel",
    });
    setPendingAction(() => () => {
      saveFavourites([]);
      setFavourites([]);
    });
  }, [favourites.length]);

  // -- Group actions --
  const handleCreateGroup = useCallback((name: string) => {
    setGroups((prev) => {
      const result = createGroup(prev, name);
      return result.groups;
    });
  }, []);

  const handleDeleteGroup = useCallback((groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    setConfirmation({
      title: `Delete "${group?.name ?? "Group"}"`,
      details: [
        `This group contains ${group?.images.length ?? 0} image(s).`,
      ],
      outcomes: ["The group and all its image references will be permanently deleted."],
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
    });
    setPendingAction(() => () => {
      setGroups((prev) => deleteGroup(prev, groupId));
    });
  }, [groups]);

  const handleRenameGroup = useCallback((groupId: string, name: string) => {
    setGroups((prev) => renameGroup(prev, groupId, name));
  }, []);

  const handleRemoveImageFromGroup = useCallback((groupId: string, imageId: string) => {
    setGroups((prev) => removeImageFromGroup(prev, groupId, imageId));
  }, []);

  // -- Confirmation dialog --
  const handleConfirmation = useCallback(
    (accepted: boolean) => {
      if (accepted && pendingAction) {
        pendingAction();
      }
      setConfirmation(null);
      setPendingAction(null);
    },
    [pendingAction],
  );

  const totalImages = favourites.length + groups.reduce((s, g) => s + g.images.length, 0);

  return (
    <CyberPanel
      id="collections-page"
      data-testid="collections-page"
      className="rounded-[28px] p-4 sm:p-5 xl:p-6"
    >
      <PageHeader
        testId="collections-header"
        subtitle="deedlit.dev // collections"
        title="Collections"
        description="Manage your favourited images and custom groups."
        pills={
          <>
            <InfoChip>Favourites: {favourites.length}</InfoChip>
            <InfoChip>Groups: {groups.length}</InfoChip>
            <InfoChip>Total refs: {totalImages}</InfoChip>
          </>
        }
      />

      {/* Tab switcher */}
      <div className="mt-6">
        <SegmentedControl
          value={activeTab}
          onValueChange={setActiveTab}
          className="inline-flex rounded-xl border border-ui-border-soft bg-panel/70 p-1"
          optionClassName="rounded-lg px-4 py-1.5 text-ui-sm"
          options={[
            { value: "favourites", label: `Favourites (${favourites.length})` },
            { value: "groups", label: `Groups (${groups.length})` },
          ]}
        />
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {activeTab === "favourites" ? (
          <FavouritesSection
            favourites={favourites}
            onRemove={handleRemoveFavourite}
            onClearAll={handleClearAllFavourites}
            onImageClick={handleImageClick}
          />
        ) : (
          <GroupsSection
            groups={groups}
            onCreateGroup={handleCreateGroup}
            onDeleteGroup={handleDeleteGroup}
            onRenameGroup={handleRenameGroup}
            onRemoveImage={handleRemoveImageFromGroup}
            onImageClick={handleImageClick}
          />
        )}
      </div>

      {/* Confirmation dialog */}
      {confirmation && (
        <ConfirmationDialog dialog={confirmation} onClose={handleConfirmation} />
      )}

      {/* Image details modal */}
      <StandaloneImageModal
        image={selectedImage}
        onClose={() => setSelectedImage(null)}
      />
    </CyberPanel>
  );
}

