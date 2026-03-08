import path from "node:path";

const DEFAULT_STORAGE_BASE_DIR = "H:\\local-apps";
const APP_STORAGE_FOLDER = "deedlit.dev.comfyhelper";

export type StorageProfile = "dev" | "live";

function normalizeConfiguredDirectory(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return path.resolve(trimmed);
}

function resolveStorageProfile(value: string | undefined): StorageProfile {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "dev" || normalized === "live") {
    return normalized;
  }

  return process.env.NODE_ENV === "production" ? "live" : "dev";
}

export function getStorageConfig() {
  const baseDirectory =
    normalizeConfiguredDirectory(process.env.COMFYHELPER_STORAGE_BASE_DIR) ?? DEFAULT_STORAGE_BASE_DIR;
  const profile = resolveStorageProfile(process.env.COMFYHELPER_STORAGE_PROFILE);
  const appDirectory = path.join(baseDirectory, APP_STORAGE_FOLDER);
  const profileDirectory = path.join(appDirectory, profile);
  const dataDirectory = path.join(profileDirectory, "data");
  const databasePath = path.join(dataDirectory, "comfyhelper.db");
  const databaseBackupPath = path.join(dataDirectory, "comfyhelper.db.migrate-backup");
  const trashDirectory = path.join(profileDirectory, "trash");

  return {
    baseDirectory,
    profile,
    appDirectory,
    profileDirectory,
    dataDirectory,
    databasePath,
    databaseBackupPath,
    trashDirectory,
    databaseDisplayPath: path.join(APP_STORAGE_FOLDER, profile, "data", "comfyhelper.db"),
  };
}
