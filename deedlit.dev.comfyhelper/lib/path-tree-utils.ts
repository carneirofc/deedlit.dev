import type { ImageRecord } from "./library-types";
import type { MutablePathTreeNode, PathLevel, PathTreeNode } from "./gallery-types";

export function normalizePathKey(pathValue: string): string {
  let normalized = pathValue.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!normalized) {
    return "/";
  }

  const windowsDrive = normalized.match(/^([A-Za-z]:)(\/.*)?$/);
  if (windowsDrive) {
    const drive = windowsDrive[1].toLowerCase();
    const rest = windowsDrive[2] ?? "/";
    if (rest === "/" || !rest) {
      return `${drive}/`;
    }

    return `${drive}${rest.replace(/\/$/, "")}`;
  }

  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function getDirectoryPath(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  const separatorIndex = normalized.lastIndexOf("/");
  if (separatorIndex < 0) {
    return normalized;
  }

  const directory = normalized.slice(0, separatorIndex);
  if (/^[A-Za-z]:$/.test(directory)) {
    return `${directory}/`;
  }

  return directory || "/";
}

export function splitDirectoryIntoLevels(directoryPath: string): PathLevel[] {
  const normalized = directoryPath.replace(/\\/g, "/").replace(/\/+/g, "/");
  const windowsDrive = normalized.match(/^([A-Za-z]:)(\/.*)?$/);

  if (windowsDrive) {
    const drive = windowsDrive[1];
    const restParts = (windowsDrive[2] ?? "/").split("/").filter(Boolean);
    const levels: PathLevel[] = [
      {
        key: normalizePathKey(`${drive}/`),
        label: `${drive}\\`,
        displayPath: `${drive}\\`,
      },
    ];

    let currentPath = `${drive}/`;
    for (const part of restParts) {
      currentPath = `${currentPath}${part}/`;
      levels.push({
        key: normalizePathKey(currentPath),
        label: part,
        displayPath: currentPath.replace(/\//g, "\\").replace(/\\$/, ""),
      });
    }

    return levels;
  }

  const unixParts = normalized.split("/").filter(Boolean);
  if (normalized.startsWith("/")) {
    const levels: PathLevel[] = [
      {
        key: "/",
        label: "/",
        displayPath: "/",
      },
    ];

    let current = "";
    for (const part of unixParts) {
      current = `${current}/${part}`;
      levels.push({
        key: normalizePathKey(current),
        label: part,
        displayPath: current,
      });
    }

    return levels;
  }

  const levels: PathLevel[] = [];
  let current = "";
  for (const part of unixParts) {
    current = current ? `${current}/${part}` : part;
    levels.push({
      key: normalizePathKey(current),
      label: part,
      displayPath: current,
    });
  }

  return levels;
}

export function isWithinPathPrefix(pathKey: string, prefixKey: string): boolean {
  if (pathKey === prefixKey) {
    return true;
  }

  if (prefixKey.endsWith("/")) {
    return pathKey.startsWith(prefixKey);
  }

  return pathKey.startsWith(`${prefixKey}/`);
}

export function collapseToDeepestNode(node: PathTreeNode): PathTreeNode {
  let cursor = node;
  while (cursor.children.length === 1) {
    cursor = cursor.children[0];
  }
  return cursor;
}

export function getDeepestNodes(nodes: PathTreeNode[]): PathTreeNode[] {
  const unique = new Map<string, PathTreeNode>();
  for (const node of nodes) {
    const deepest = collapseToDeepestNode(node);
    unique.set(deepest.key, deepest);
  }
  return Array.from(unique.values()).sort((a, b) => a.displayPath.localeCompare(b.displayPath));
}

export function buildPathTree(images: ImageRecord[]): { tree: PathTreeNode[]; index: Map<string, PathTreeNode> } {
  const rootMap = new Map<string, MutablePathTreeNode>();
  const mutableIndex = new Map<string, MutablePathTreeNode>();

  for (const image of images) {
    const directory = getDirectoryPath(image.absolutePath);
    const levels = splitDirectoryIntoLevels(directory);
    if (levels.length === 0) {
      continue;
    }

    let parent: MutablePathTreeNode | null = null;
    for (const level of levels) {
      let node = mutableIndex.get(level.key);
      if (!node) {
        const parentKey: string | null = parent ? parent.key : null;
        node = {
          key: level.key,
          label: level.label,
          displayPath: level.displayPath,
          imageCount: 0,
          parentKey,
          childrenMap: new Map<string, MutablePathTreeNode>(),
        };

        mutableIndex.set(level.key, node);

        if (parent) {
          parent.childrenMap.set(level.key, node);
        } else {
          rootMap.set(level.key, node);
        }
      }

      node.imageCount += 1;
      parent = node;
    }
  }

  const index = new Map<string, PathTreeNode>();

  const serialize = (node: MutablePathTreeNode): PathTreeNode => {
    const children = Array.from(node.childrenMap.values())
      .sort((a, b) => a.displayPath.localeCompare(b.displayPath))
      .map(serialize);

    const serialized: PathTreeNode = {
      key: node.key,
      label: node.label,
      displayPath: node.displayPath,
      imageCount: node.imageCount,
      parentKey: node.parentKey,
      children,
    };

    index.set(serialized.key, serialized);
    return serialized;
  };

  const tree = Array.from(rootMap.values())
    .sort((a, b) => a.displayPath.localeCompare(b.displayPath))
    .map(serialize);

  return { tree, index };
}
