import { stat } from "node:fs/promises";

import { SystemInfoResponseSchema } from "@/lib/contracts/api";
import { errorJson, jsonWithSchema } from "@/lib/http/route-response";
import { listRoots } from "@/lib/config-store";
import { prisma, ensureDatabase, getDatabasePathInfo } from "@/lib/db/client";
import { countCachedImagesByRootIds } from "@/lib/image-cache-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabase();

    const pathInfo = getDatabasePathInfo();
    let fileSizeBytes: number | null = null;

    try {
      const fileStat = await stat(pathInfo.absolutePath);
      fileSizeBytes = fileStat.size;
    } catch {
      fileSizeBytes = null;
    }

    const [rootCount, settingsCount, cacheCount, scanJobsCount, roots] = await Promise.all([
      prisma.rootDirectory.count(),
      prisma.appSetting.count(),
      prisma.imageCache.count(),
      prisma.scanJob.count(),
      listRoots(),
    ]);

    const visibleRoots = roots.filter((root) => root.isVisible);
    const hiddenRoots = roots.length - visibleRoots.length;
    const visibleCachedImages = await countCachedImagesByRootIds(visibleRoots.map((root) => root.id));

    return jsonWithSchema(SystemInfoResponseSchema, {
      sqlite: {
        relativePath: pathInfo.relativePath,
        absolutePath: pathInfo.absolutePath,
        fileSizeBytes,
        baseDirectory: pathInfo.baseDirectory,
        profile: pathInfo.profile,
      },
      database: {
        tableRows: {
          rootDirectories: rootCount,
          appSettings: settingsCount,
          imageCache: cacheCount,
          scanJobs: scanJobsCount,
        },
        roots: {
          total: roots.length,
          visible: visibleRoots.length,
          hidden: hiddenRoots,
        },
      },
      library: {
        visibleCachedImages,
      },
    });
  } catch {
    return errorJson("Failed to load system information.", 500);
  }
}
