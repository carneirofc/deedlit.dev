import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import type { AppSettings, RootDirectory, TagFilterPreset } from "@/lib/library-types";
import { prisma, ensureDatabase } from "@/lib/db/client";
import { removeCachedImagesForRoot } from "@/lib/image-cache-store";
import { tryParseJson } from "@/lib/json-utils";
import { normalizeExcludedTags } from "@/lib/prompt-tags";
import { AppSettingsSchema, RootDirectorySchema } from "@/lib/schemas";

const DEFAULT_GALLERY_COLUMNS = 7;
const DEFAULT_GALLERY_IMAGE_LIMIT = 10000;
const LEGACY_SCAN_LIMIT_SETTING_KEY = "default_scan_limit";
const GALLERY_COLUMNS_SETTING_KEY = "gallery_columns";
const GALLERY_IMAGE_LIMIT_SETTING_KEY = "gallery_image_limit";
const EXCLUDED_TAGS_SETTING_KEY = "excluded_tags";
const TAG_FILTER_PRESETS_SETTING_KEY = "tag_filter_presets";
const TRASHCAN_DIRECTORY_SETTING_KEY = "trashcan_directory";

export class ConfigStoreError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = "ConfigStoreError";
  }
}

function sanitizeInputPath(rawPath: string): string {
  return rawPath.trim().replace(/^["']|["']$/g, "");
}

function normalizeForComparison(rawPath: string): string {
  const resolved = path.resolve(rawPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function nowMs(): number {
  return Date.now();
}

function toRootDirectory(row: {
  id: string;
  path: string;
  createdAtMs: number;
  isVisible: boolean | number;
}): RootDirectory {
  return RootDirectorySchema.parse({
    id: row.id,
    path: row.path,
    createdAt: new Date(row.createdAtMs).toISOString(),
    isVisible: Boolean(row.isVisible),
  });
}

function parseSettingValue(rawValue: string, fallback: number): number {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function parseExcludedTagsSetting(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  const parsed = tryParseJson(rawValue);
  if (Array.isArray(parsed)) {
    return normalizeExcludedTags(parsed.filter((value): value is string => typeof value === "string"));
  }

  return normalizeExcludedTags(
    rawValue
      .split(/[\r\n,]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function normalizePresetTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return Array.from(
    new Set(
      tags
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function parseTagFilterPresetsSetting(rawValue: string | undefined): TagFilterPreset[] {
  if (!rawValue) {
    return [];
  }

  const parsed = tryParseJson(rawValue);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const createdAt =
        typeof record.createdAt === "string" && record.createdAt.trim()
          ? record.createdAt
          : new Date().toISOString();
      const positiveTags = normalizePresetTags(record.positiveTags);
      const negativeTags = normalizePresetTags(record.negativeTags);

      if (!id || !name || (positiveTags.length === 0 && negativeTags.length === 0)) {
        return null;
      }

      return {
        id,
        name,
        createdAt,
        positiveTags,
        negativeTags,
      } satisfies TagFilterPreset;
    })
    .filter((entry): entry is TagFilterPreset => Boolean(entry))
    .slice(0, 80)
    .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt));
}

function parseTrashcanDirectorySetting(rawValue: string | undefined): string | null {
  if (!rawValue) {
    return null;
  }

  const sanitizedPath = sanitizeInputPath(rawValue);
  if (!sanitizedPath) {
    return null;
  }

  return path.resolve(sanitizedPath);
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /UNIQUE constraint failed/i.test(error.message);
}

async function ensureDefaultSettings(): Promise<void> {
  const timestamp = nowMs();

  await Promise.all([
    prisma.appSetting.upsert({
      where: { key: GALLERY_COLUMNS_SETTING_KEY },
      create: { key: GALLERY_COLUMNS_SETTING_KEY, value: String(DEFAULT_GALLERY_COLUMNS), updatedAtMs: timestamp },
      update: {},
    }),
    prisma.appSetting.upsert({
      where: { key: GALLERY_IMAGE_LIMIT_SETTING_KEY },
      create: { key: GALLERY_IMAGE_LIMIT_SETTING_KEY, value: String(DEFAULT_GALLERY_IMAGE_LIMIT), updatedAtMs: timestamp },
      update: {},
    }),
    prisma.appSetting.upsert({
      where: { key: EXCLUDED_TAGS_SETTING_KEY },
      create: { key: EXCLUDED_TAGS_SETTING_KEY, value: "[]", updatedAtMs: timestamp },
      update: {},
    }),
    prisma.appSetting.upsert({
      where: { key: TAG_FILTER_PRESETS_SETTING_KEY },
      create: { key: TAG_FILTER_PRESETS_SETTING_KEY, value: "[]", updatedAtMs: timestamp },
      update: {},
    }),
    prisma.appSetting.deleteMany({ where: { key: LEGACY_SCAN_LIMIT_SETTING_KEY } }),
  ]);
}

type ListRootsOptions = {
  visibleOnly?: boolean;
};

export async function listRoots(options: ListRootsOptions = {}): Promise<RootDirectory[]> {
  await ensureDatabase();

  const rows = await prisma.rootDirectory.findMany({
    ...(options.visibleOnly ? { where: { isVisible: true } } : {}),
    orderBy: { createdAtMs: "desc" },
  });

  return rows.map(toRootDirectory);
}

export async function addRoot(rawPath: string): Promise<RootDirectory> {
  await ensureDatabase();

  const sanitizedPath = sanitizeInputPath(rawPath);

  if (!sanitizedPath) {
    throw new ConfigStoreError("Root path is required.");
  }

  const resolvedPath = path.resolve(sanitizedPath);
  const resolvedPathNorm = normalizeForComparison(resolvedPath);

  let rootStats;
  try {
    rootStats = await stat(resolvedPath);
  } catch {
    throw new ConfigStoreError(`Path does not exist: ${resolvedPath}`, 404);
  }

  if (!rootStats.isDirectory()) {
    throw new ConfigStoreError("Path must point to a directory.");
  }

  const rootId = randomUUID();
  const createdAtMs = nowMs();

  try {
    await prisma.rootDirectory.create({
      data: {
        id: rootId,
        path: resolvedPath,
        pathNorm: resolvedPathNorm,
        createdAtMs,
        isVisible: true,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ConfigStoreError("This root directory is already configured.", 409);
    }

    throw error;
  }

  return toRootDirectory({
    id: rootId,
    path: resolvedPath,
    createdAtMs,
    isVisible: true,
  });
}

export async function removeRoot(rootId: string): Promise<void> {
  await ensureDatabase();

  const deleted = await prisma.rootDirectory.deleteMany({
    where: { id: rootId },
  });

  if (deleted.count === 0) {
    throw new ConfigStoreError("Root not found.", 404);
  }

  await removeCachedImagesForRoot(rootId);
}

export async function setRootVisibility(rootId: string, isVisible: boolean): Promise<RootDirectory> {
  await ensureDatabase();

  const existing = await prisma.rootDirectory.findUnique({ where: { id: rootId } });

  if (!existing) {
    throw new ConfigStoreError("Root not found.", 404);
  }

  const updated = await prisma.rootDirectory.update({
    where: { id: rootId },
    data: { isVisible },
  });

  return toRootDirectory(updated);
}

export async function getSettings(): Promise<AppSettings> {
  await ensureDatabase();
  await ensureDefaultSettings();

  const rows = await prisma.appSetting.findMany();
  const galleryColumnsRow = rows.find((row) => row.key === GALLERY_COLUMNS_SETTING_KEY);
  const galleryImageLimitRow = rows.find((row) => row.key === GALLERY_IMAGE_LIMIT_SETTING_KEY);
  const excludedTagsRow = rows.find((row) => row.key === EXCLUDED_TAGS_SETTING_KEY);
  const tagFilterPresetsRow = rows.find((row) => row.key === TAG_FILTER_PRESETS_SETTING_KEY);
  const trashcanDirectoryRow = rows.find((row) => row.key === TRASHCAN_DIRECTORY_SETTING_KEY);

  const settings = {
    galleryColumns: galleryColumnsRow
      ? parseSettingValue(galleryColumnsRow.value, DEFAULT_GALLERY_COLUMNS)
      : DEFAULT_GALLERY_COLUMNS,
    galleryImageLimit: galleryImageLimitRow
      ? parseSettingValue(galleryImageLimitRow.value, DEFAULT_GALLERY_IMAGE_LIMIT)
      : DEFAULT_GALLERY_IMAGE_LIMIT,
    excludedTags: parseExcludedTagsSetting(excludedTagsRow?.value),
    tagFilterPresets: parseTagFilterPresetsSetting(tagFilterPresetsRow?.value),
    trashcanDirectory: parseTrashcanDirectorySetting(trashcanDirectoryRow?.value),
  };

  return AppSettingsSchema.parse(settings);
}

export async function getTrashcanDirectory(): Promise<string | null> {
  await ensureDatabase();

  const envConfiguredPath = process.env.COMFYHELPER_TRASHCAN_DIR?.trim();
  if (envConfiguredPath) {
    return path.resolve(envConfiguredPath);
  }

  const row = await prisma.appSetting.findUnique({
    where: { key: TRASHCAN_DIRECTORY_SETTING_KEY },
    select: { value: true },
  });
  if (!row) {
    return null;
  }

  const configuredPath = row.value.trim();
  if (!configuredPath) {
    return null;
  }

  return path.resolve(configuredPath);
}

export async function updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  await ensureDatabase();
  await ensureDefaultSettings();

  const current = await getSettings();
  const merged = AppSettingsSchema.parse({
    ...current,
    ...partial,
    excludedTags:
      partial.excludedTags !== undefined ? normalizeExcludedTags(partial.excludedTags) : current.excludedTags,
    tagFilterPresets: partial.tagFilterPresets ?? current.tagFilterPresets,
    trashcanDirectory:
      partial.trashcanDirectory !== undefined
        ? parseTrashcanDirectorySetting(partial.trashcanDirectory ?? undefined)
        : current.trashcanDirectory,
  });

  const timestamp = nowMs();

  await Promise.all([
    prisma.appSetting.upsert({
      where: { key: GALLERY_COLUMNS_SETTING_KEY },
      create: { key: GALLERY_COLUMNS_SETTING_KEY, value: String(merged.galleryColumns), updatedAtMs: timestamp },
      update: { value: String(merged.galleryColumns), updatedAtMs: timestamp },
    }),
    prisma.appSetting.upsert({
      where: { key: GALLERY_IMAGE_LIMIT_SETTING_KEY },
      create: { key: GALLERY_IMAGE_LIMIT_SETTING_KEY, value: String(merged.galleryImageLimit), updatedAtMs: timestamp },
      update: { value: String(merged.galleryImageLimit), updatedAtMs: timestamp },
    }),
    prisma.appSetting.upsert({
      where: { key: EXCLUDED_TAGS_SETTING_KEY },
      create: { key: EXCLUDED_TAGS_SETTING_KEY, value: JSON.stringify(merged.excludedTags), updatedAtMs: timestamp },
      update: { value: JSON.stringify(merged.excludedTags), updatedAtMs: timestamp },
    }),
    prisma.appSetting.upsert({
      where: { key: TAG_FILTER_PRESETS_SETTING_KEY },
      create: { key: TAG_FILTER_PRESETS_SETTING_KEY, value: JSON.stringify(merged.tagFilterPresets), updatedAtMs: timestamp },
      update: { value: JSON.stringify(merged.tagFilterPresets), updatedAtMs: timestamp },
    }),
    merged.trashcanDirectory === null
      ? prisma.appSetting.deleteMany({ where: { key: TRASHCAN_DIRECTORY_SETTING_KEY } })
      : prisma.appSetting.upsert({
          where: { key: TRASHCAN_DIRECTORY_SETTING_KEY },
          create: { key: TRASHCAN_DIRECTORY_SETTING_KEY, value: merged.trashcanDirectory, updatedAtMs: timestamp },
          update: { value: merged.trashcanDirectory, updatedAtMs: timestamp },
        }),
  ]);

  return merged;
}
