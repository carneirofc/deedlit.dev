import { getSettings, listRoots } from "@/lib/config-store";
import { getLatestScanJob } from "@/lib/image-cache-store";
import type { AppSettings, RootDirectory, ScanJobInfo } from "@/lib/library-types";

export type VisibleRootsContext = {
  roots: RootDirectory[];
  rootIds: string[];
  rootIdSet: Set<string>;
};

export type VisibleImagesRouteContext = VisibleRootsContext & {
  settings: AppSettings;
  scan: ScanJobInfo | null;
};

function buildVisibleRootsContext(roots: RootDirectory[]): VisibleRootsContext {
  const rootIds = roots.map((root) => root.id);

  return {
    roots,
    rootIds,
    rootIdSet: new Set(rootIds),
  };
}

export async function loadVisibleRootsContext(): Promise<VisibleRootsContext> {
  const roots = await listRoots({ visibleOnly: true });
  return buildVisibleRootsContext(roots);
}

export async function loadVisibleImagesRouteContext(): Promise<VisibleImagesRouteContext> {
  const [roots, settings, scan] = await Promise.all([
    listRoots({ visibleOnly: true }),
    getSettings(),
    getLatestScanJob(),
  ]);

  return {
    ...buildVisibleRootsContext(roots),
    settings,
    scan,
  };
}