"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type CollectionImage,
  type ImageGroup,
  loadFavourites,
  loadGroups,
  toggleFavourite as toggleFav,
  isFavourite as isFav,
  createGroup as createGrp,
  deleteGroup as deleteGrp,
  renameGroup as renameGrp,
  addImageToGroup as addImg,
  removeImageFromGroup as removeImg,
  getGroupsForImage,
} from "@/lib/collections-store";

export type CollectionsHook = {
  favourites: CollectionImage[];
  groups: ImageGroup[];
  isFavourite: (imageId: string) => boolean;
  toggleFavourite: (imageId: string, absolutePath: string, fileName: string) => void;
  createGroup: (name: string) => ImageGroup;
  deleteGroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  addImageToGroup: (groupId: string, imageId: string, absolutePath: string, fileName: string) => void;
  removeImageFromGroup: (groupId: string, imageId: string) => void;
  getGroupsForImage: (imageId: string) => ImageGroup[];
};

export function useCollections(): CollectionsHook {
  const [favourites, setFavourites] = useState<CollectionImage[]>([]);
  const [groups, setGroups] = useState<ImageGroup[]>([]);

  // Hydrate from localStorage after mount
  useEffect(() => {
    setFavourites(loadFavourites());
    setGroups(loadGroups());
  }, []);

  const isFavourite = useCallback(
    (imageId: string) => isFav(favourites, imageId),
    [favourites],
  );

  const toggleFavourite = useCallback(
    (imageId: string, absolutePath: string, fileName: string) => {
      setFavourites((prev) => toggleFav(prev, imageId, absolutePath, fileName));
    },
    [],
  );

  const createGroup = useCallback((name: string): ImageGroup => {
    let newGroup: ImageGroup | undefined;
    setGroups((prev) => {
      const result = createGrp(prev, name);
      newGroup = result.newGroup;
      return result.groups;
    });
    return newGroup!;
  }, []);

  const deleteGroup = useCallback((groupId: string) => {
    setGroups((prev) => deleteGrp(prev, groupId));
  }, []);

  const renameGroup = useCallback((groupId: string, name: string) => {
    setGroups((prev) => renameGrp(prev, groupId, name));
  }, []);

  const addImageToGroup = useCallback(
    (groupId: string, imageId: string, absolutePath: string, fileName: string) => {
      setGroups((prev) => addImg(prev, groupId, imageId, absolutePath, fileName));
    },
    [],
  );

  const removeImageFromGroup = useCallback((groupId: string, imageId: string) => {
    setGroups((prev) => removeImg(prev, groupId, imageId));
  }, []);

  const getGroupsFor = useCallback(
    (imageId: string) => getGroupsForImage(groups, imageId),
    [groups],
  );

  return {
    favourites,
    groups,
    isFavourite,
    toggleFavourite,
    createGroup,
    deleteGroup,
    renameGroup,
    addImageToGroup,
    removeImageFromGroup,
    getGroupsForImage: getGroupsFor,
  };
}
