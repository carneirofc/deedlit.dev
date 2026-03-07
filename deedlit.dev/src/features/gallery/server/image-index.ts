import "server-only";

import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const isDev = process.env.NODE_ENV === 'development';
const log = (...args: any[]) => isDev && console.log('[IMAGE_INDEX]', ...args);

const IMAGE_DIR = path.join(process.cwd(), "public", "images");
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".svg"]);
const EXCLUDED_FILES = new Set(["og-cover.svg", "icon.svg"]);
const SNAPSHOT_TTL_MS = 10000;
const WATCH_DEBOUNCE_MS = 250;

log(`[INFO] Image directory: ${IMAGE_DIR}`);
log(`Supported extensions:`, Array.from(IMAGE_EXTS));
log(`Excluded files:`, Array.from(EXCLUDED_FILES));

export interface IndexedImage {
  id: string;
  filename: string;
  createdAt: string;
  createdAtMs: number;
}

function baseId(filename: string) {
  return createHash("sha256").update(filename).digest("hex").slice(0, 16);
}

interface IndexedSnapshot {
  images: IndexedImage[];
  refreshedAt: number;
}

let snapshot: IndexedSnapshot | null = null;
let refreshing: Promise<IndexedSnapshot> | null = null;
let watcher: fs.FSWatcher | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

function getCreatedAtMs(stat: fs.Stats) {
  if (Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0) return stat.birthtimeMs;
  return stat.mtimeMs;
}

async function scanImageDir(): Promise<IndexedImage[]> {
  log('[DEBUG] Scanning image directory...');
  const startTime = performance.now();
  
  const entries = await fsPromises.readdir(IMAGE_DIR, { withFileTypes: true });
  log(`Found ${entries.length} total entries in directory`);
  
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !EXCLUDED_FILES.has(name))
    .filter((name) => IMAGE_EXTS.has(path.extname(name).toLowerCase()));

  log(`Filtered to ${files.length} valid image files`);

  const withStats = await Promise.all(
    files.map(async (filename) => {
      const absolute = path.join(IMAGE_DIR, filename);
      const stat = await fsPromises.stat(absolute);
      const createdAtMs = getCreatedAtMs(stat);
      return {
        filename,
        createdAtMs
      };
    })
  );

  withStats.sort((a, b) => {
    if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs;
    return b.filename.localeCompare(a.filename);
  });

  const used = new Set<string>();
  const indexed: IndexedImage[] = [];

  for (const item of withStats) {
    const filename = item.filename;
    let id = baseId(filename);
    let suffix = 1;
    while (used.has(id)) {
      id = `${baseId(filename)}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    indexed.push({
      id,
      filename,
      createdAtMs: item.createdAtMs,
      createdAt: new Date(item.createdAtMs).toISOString()
    });
  }

  const endTime = performance.now();
  const duration = (endTime - startTime).toFixed(2);
  log(`[SUCCESS] Indexed ${indexed.length} images in ${duration}ms`);

  return indexed;
}

async function rebuildSnapshot(): Promise<IndexedSnapshot> {
  log('[INFO] Rebuilding image snapshot...');
  const images = await scanImageDir();
  const nextSnapshot = {
    images,
    refreshedAt: Date.now()
  };
  snapshot = nextSnapshot;
  log(`[DEBUG] Snapshot cached with ${images.length} images`);
  return nextSnapshot;
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  log(`[DEBUG] Scheduling refresh in ${WATCH_DEBOUNCE_MS}ms...`);
  refreshTimer = setTimeout(() => {
    refreshing = rebuildSnapshot().finally(() => {
      refreshing = null;
    });
  }, WATCH_DEBOUNCE_MS);
}

function ensureWatcher() {
  if (watcher) return;
  log('[INFO] Starting file system watcher...');
  try {
    watcher = fs.watch(IMAGE_DIR, { persistent: false }, () => {
      log('[WARN] File system change detected');
      scheduleRefresh();
    });
    watcher.on("error", (error) => {
      log('[ERROR] Watcher error:', error);
      watcher = null;
    });
    log('[SUCCESS] File system watcher started');
  } catch (error) {
    log('[ERROR] Failed to start watcher:', error);
    watcher = null;
  }
}

async function getSnapshot(): Promise<IndexedSnapshot> {
  ensureWatcher();

  if (refreshing) {
    log('[DEBUG] Waiting for refresh to complete...');
    return refreshing;
  }

  const stale = !snapshot || Date.now() - snapshot.refreshedAt > SNAPSHOT_TTL_MS;
  if (snapshot && !stale) {
    const age = Date.now() - snapshot.refreshedAt;
    log(`[DEBUG] Using cached snapshot (age: ${age}ms)`);
    return snapshot;
  }

  log('[INFO] Snapshot stale or missing, refreshing...');
  refreshing = rebuildSnapshot().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function getIndexedImages(): Promise<IndexedImage[]> {
  const current = await getSnapshot();
  log(`[DEBUG] Returning ${current.images.length} indexed images`);
  return current.images;
}

export async function getImageById(id: string): Promise<IndexedImage | null> {
  log(`[DEBUG] Looking up image by id: ${id}`);
  const images = await getIndexedImages();
  const found = images.find((image) => image.id === id) ?? null;
  if (found) {
    log(`[SUCCESS] Found image: ${found.filename}`);
  } else {
    log(`[ERROR] Image not found: ${id}`);
  }
  return found;
}
