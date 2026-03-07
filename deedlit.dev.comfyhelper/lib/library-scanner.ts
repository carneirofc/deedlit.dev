import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { ImageRecord, RootDirectory } from "@/lib/library-types";
import { isPathWithinRoot } from "@/lib/path-utils";
import { readEmbeddedMetadataFromPng } from "@/lib/png-metadata";

export type MetadataResult = {
  metadataPath?: string;
  metadata?: unknown;
  metadataError?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown error";
}

function toUiRelativePath(rootPath: string, absolutePath: string): string {
  return path.relative(rootPath, absolutePath).replace(/\\/g, "/");
}

export async function readMetadataForImage(imagePath: string): Promise<MetadataResult> {
  const directory = path.dirname(imagePath);
  const imageName = path.basename(imagePath);
  const imageStem = path.basename(imagePath, path.extname(imagePath));
  const candidates = Array.from(
    new Set([path.join(directory, `${imageName}.json`), path.join(directory, `${imageStem}.json`)]),
  );

  for (const candidate of candidates) {
    try {
      const candidateStats = await stat(candidate);
      if (!candidateStats.isFile()) {
        continue;
      }

      const rawJson = await readFile(candidate, "utf8");
      return {
        metadataPath: candidate,
        metadata: JSON.parse(rawJson) as unknown,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }

      return {
        metadataPath: candidate,
        metadataError: getErrorMessage(error),
      };
    }
  }

  const embedded = await readEmbeddedMetadataFromPng(imagePath);
  if (embedded.metadata !== undefined) {
    return {
      metadataPath: imagePath,
      metadata: embedded.metadata,
    };
  }

  if (embedded.error) {
    return {
      metadataError: `PNG metadata parse failed: ${embedded.error}`,
    };
  }

  return {};
}

export async function walkPngFiles(
  directory: string,
  onPngFile: (absolutePath: string) => Promise<boolean>,
  warnings: string[],
): Promise<boolean> {
  let entries: Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    warnings.push(`Could not read ${directory}: ${getErrorMessage(error)}`);
    return false;
  }

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      const shouldStop = await walkPngFiles(absolutePath, onPngFile, warnings);
      if (shouldStop) {
        return true;
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (path.extname(entry.name).toLowerCase() !== ".png") {
      continue;
    }

    const shouldStop = await onPngFile(absolutePath);
    if (shouldStop) {
      return true;
    }
  }

  return false;
}

export async function scanLibrary(
  roots: RootDirectory[],
): Promise<{ images: ImageRecord[]; warnings: string[] }> {
  const images: ImageRecord[] = [];
  const warnings: string[] = [];

  for (const root of roots) {
    await walkPngFiles(
      root.path,
      async (absolutePath) => {
        let fileStats;
        try {
          fileStats = await stat(absolutePath);
        } catch (error) {
          warnings.push(`Could not stat ${absolutePath}: ${getErrorMessage(error)}`);
          return false;
        }

        const metadata = await readMetadataForImage(absolutePath);
        const relativePath = toUiRelativePath(root.path, absolutePath);

        images.push({
          id: `${root.id}:${relativePath}`,
          rootId: root.id,
          rootPath: root.path,
          absolutePath,
          relativePath,
          fileName: path.basename(absolutePath),
          size: fileStats.size,
          modifiedAt: fileStats.mtime.toISOString(),
          metadataPath: metadata.metadataPath,
          metadata: metadata.metadata,
          metadataError: metadata.metadataError,
        });

        return false;
      },
      warnings,
    );
  }

  images.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return { images, warnings };
}

export async function countPngImages(
  roots: RootDirectory[],
): Promise<{ count: number; warnings: string[] }> {
  let count = 0;
  const warnings: string[] = [];

  for (const root of roots) {
    await walkPngFiles(
      root.path,
      async () => {
        count += 1;
        return false;
      },
      warnings,
    );
  }

  return { count, warnings };
}

export function isAllowedImagePath(candidatePath: string, roots: RootDirectory[]): boolean {
  if (path.extname(candidatePath).toLowerCase() !== ".png") {
    return false;
  }

  const resolvedCandidate = path.resolve(candidatePath);
  return roots.some((root) => isPathWithinRoot(resolvedCandidate, root.path));
}
