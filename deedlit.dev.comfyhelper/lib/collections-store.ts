/**
 * Collections Store — Favourites & Image Groups
 *
 * All image references use URL locations (API paths) so collections
 * work regardless of the underlying file system.
 *
 * Persisted entirely in localStorage.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollectionImage = {
  /** Unique cache id of the image (from ImageRecord.id) */
  id: string;
  /** URL location used to load the image (e.g. /api/image?path=...) */
  url: string;
  /** Human-friendly file name */
  fileName: string;
  /** Timestamp when the image was added to the collection */
  addedAt: number;
};

export type ImageGroup = {
  /** Generated UUID for the group */
  id: string;
  /** User-provided name */
  name: string;
  /** Optional hex colour for the group pill */
  colour: string;
  /** Ordered list of image references */
  images: CollectionImage[];
  /** Creation timestamp */
  createdAt: number;
  /** Last-modified timestamp */
  updatedAt: number;
};

export type CollectionsState = {
  favourites: CollectionImage[];
  groups: ImageGroup[];
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const STORAGE_KEY_FAVOURITES = "gallery-favourites";
const STORAGE_KEY_GROUPS = "gallery-image-groups";

// ---------------------------------------------------------------------------
// Colour palette for new groups
// ---------------------------------------------------------------------------

const GROUP_COLOURS = [
  "#f43f5e", // rose
  "#8b5cf6", // violet
  "#3b82f6", // blue
  "#06b6d4", // cyan
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#6366f1", // indigo
];

let colourIndex = 0;

function nextGroupColour(): string {
  const colour = GROUP_COLOURS[colourIndex % GROUP_COLOURS.length]!;
  colourIndex += 1;
  return colour;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded — best-effort
  }
}

// ---------------------------------------------------------------------------
// Build an image URL from id / absolutePath
// ---------------------------------------------------------------------------

export function toCollectionImageUrl(absolutePath: string): string {
  return `/api/image?path=${encodeURIComponent(absolutePath)}`;
}

// ---------------------------------------------------------------------------
// Favourites
// ---------------------------------------------------------------------------

export function loadFavourites(): CollectionImage[] {
  return readJson<CollectionImage[]>(STORAGE_KEY_FAVOURITES, []);
}

export function saveFavourites(favourites: CollectionImage[]): void {
  writeJson(STORAGE_KEY_FAVOURITES, favourites);
}

export function isFavourite(favourites: CollectionImage[], imageId: string): boolean {
  return favourites.some((f) => f.id === imageId);
}

export function addFavourite(
  favourites: CollectionImage[],
  imageId: string,
  absolutePath: string,
  fileName: string,
): CollectionImage[] {
  if (isFavourite(favourites, imageId)) return favourites;
  const next: CollectionImage[] = [
    ...favourites,
    {
      id: imageId,
      url: toCollectionImageUrl(absolutePath),
      fileName,
      addedAt: Date.now(),
    },
  ];
  saveFavourites(next);
  return next;
}

export function removeFavourite(
  favourites: CollectionImage[],
  imageId: string,
): CollectionImage[] {
  const next = favourites.filter((f) => f.id !== imageId);
  saveFavourites(next);
  return next;
}

export function toggleFavourite(
  favourites: CollectionImage[],
  imageId: string,
  absolutePath: string,
  fileName: string,
): CollectionImage[] {
  if (isFavourite(favourites, imageId)) {
    return removeFavourite(favourites, imageId);
  }
  return addFavourite(favourites, imageId, absolutePath, fileName);
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export function loadGroups(): ImageGroup[] {
  return readJson<ImageGroup[]>(STORAGE_KEY_GROUPS, []);
}

export function saveGroups(groups: ImageGroup[]): void {
  writeJson(STORAGE_KEY_GROUPS, groups);
}

export function createGroup(groups: ImageGroup[], name: string): { groups: ImageGroup[]; newGroup: ImageGroup } {
  const newGroup: ImageGroup = {
    id: generateId(),
    name: name.trim() || "Untitled Group",
    colour: nextGroupColour(),
    images: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const next = [...groups, newGroup];
  saveGroups(next);
  return { groups: next, newGroup };
}

export function deleteGroup(groups: ImageGroup[], groupId: string): ImageGroup[] {
  const next = groups.filter((g) => g.id !== groupId);
  saveGroups(next);
  return next;
}

export function renameGroup(groups: ImageGroup[], groupId: string, name: string): ImageGroup[] {
  const next = groups.map((g) =>
    g.id === groupId ? { ...g, name: name.trim() || g.name, updatedAt: Date.now() } : g,
  );
  saveGroups(next);
  return next;
}

export function addImageToGroup(
  groups: ImageGroup[],
  groupId: string,
  imageId: string,
  absolutePath: string,
  fileName: string,
): ImageGroup[] {
  const next = groups.map((g) => {
    if (g.id !== groupId) return g;
    if (g.images.some((img) => img.id === imageId)) return g;
    return {
      ...g,
      images: [
        ...g.images,
        {
          id: imageId,
          url: toCollectionImageUrl(absolutePath),
          fileName,
          addedAt: Date.now(),
        },
      ],
      updatedAt: Date.now(),
    };
  });
  saveGroups(next);
  return next;
}

export function removeImageFromGroup(
  groups: ImageGroup[],
  groupId: string,
  imageId: string,
): ImageGroup[] {
  const next = groups.map((g) => {
    if (g.id !== groupId) return g;
    return {
      ...g,
      images: g.images.filter((img) => img.id !== imageId),
      updatedAt: Date.now(),
    };
  });
  saveGroups(next);
  return next;
}

export function getGroupsForImage(groups: ImageGroup[], imageId: string): ImageGroup[] {
  return groups.filter((g) => g.images.some((img) => img.id === imageId));
}
