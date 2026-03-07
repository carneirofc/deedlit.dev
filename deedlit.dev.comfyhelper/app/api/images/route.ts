import { ZodError } from "zod";

import {
  DeleteCachedImageBodySchema,
  DeleteCachedImageResponseSchema,
  ImagesQuerySchema,
  ImagesResponseSchema,
  StartScanBodySchema,
  StartScanResponseSchema,
} from "@/lib/contracts/api";
import { errorJson, jsonWithSchema, zodErrorMessage } from "@/lib/http/route-response";
import { getSettings, listRoots } from "@/lib/config-store";
import {
  countCachedImagesByRootIds,
  getLatestCompletedScanTime,
  listCachedImagesByRootIds,
  queryCachedImagesByRootIds,
  removeCachedImageEntry,
  startAsyncLibraryScan,
} from "@/lib/image-cache-store";
import { loadVisibleImagesRouteContext, loadVisibleRootsContext } from "@/lib/http/route-context";
import type { ScanResult } from "@/lib/library-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withoutMetadata(images: ScanResult["images"]): ScanResult["images"] {
  return images.map((image) => ({
    ...image,
    metadata: undefined,
    generationDetails: undefined,
    workflowDetails: undefined,
    // Keep full prompt summaries so tag extraction on the frontend sees all tags.
    // The larger payload savings come from stripping metadata/generationDetails above.
    promptSummary: image.promptSummary,
  }));
}

function withoutObsoleteScanWarnings(warnings: string[]): string[] {
  return warnings.filter((warning) => !/^Image limit reached \(/i.test(warning));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = ImagesQuerySchema.parse({
      limit: searchParams.get("limit") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });

    const { roots, rootIds, settings, scan } = await loadVisibleImagesRouteContext();
    const scannedAtPromise = getLatestCompletedScanTime();

    const search = query.search?.trim() ? query.search.trim() : undefined;
    const hasPagingQuery =
      query.page !== undefined || query.pageSize !== undefined || (search !== undefined && search.length > 0);
    const shouldPaginate = query.limit === undefined && hasPagingQuery;
    const effectiveLimit = query.limit;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const imagesResultPromise = shouldPaginate
      ? queryCachedImagesByRootIds(rootIds, { search, page, pageSize })
      : listCachedImagesByRootIds(rootIds, effectiveLimit).then(async (images) => {
          if (query.limit !== undefined) {
            return { images, total: images.length };
          }

          const total = await countCachedImagesByRootIds(rootIds);
          return { images, total };
        });

    const [imagesResult, scannedAt] = await Promise.all([imagesResultPromise, scannedAtPromise]);
    const isTruncated =
      !shouldPaginate && effectiveLimit !== undefined && imagesResult.total > imagesResult.images.length;
    const responseImages = withoutMetadata(imagesResult.images);

    const response: ScanResult = {
      roots,
      settings,
      images: responseImages,
      warnings: withoutObsoleteScanWarnings(scan?.warnings ?? []),
      scannedAt,
      scan,
      total: imagesResult.total,
      page: shouldPaginate ? page : undefined,
      pageSize: shouldPaginate ? pageSize : undefined,
      search: shouldPaginate ? search : undefined,
      truncated: isTruncated,
      limitApplied: effectiveLimit,
    };

    return jsonWithSchema(ImagesResponseSchema, response);
  } catch (error) {
    console.error("[api/images] GET failed", error);
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid query string."), 400);
    }

    return errorJson("Failed to load image library.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => undefined);
    const body = StartScanBodySchema.parse(payload);

    const { roots } = await loadVisibleRootsContext();
    const { job, started } = await startAsyncLibraryScan(roots, { force: body?.force === true });
    return jsonWithSchema(StartScanResponseSchema, { job, started }, { status: started ? 202 : 200 });
  } catch (error) {
    console.error("[api/images] POST failed", error);
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid request body."), 400);
    }

    return errorJson("Failed to start image library scan.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = await request.json();
    const body = DeleteCachedImageBodySchema.parse(payload);
    const removed = await removeCachedImageEntry(body.id);

    if (!removed) {
      return errorJson("Image cache entry not found.", 404);
    }

    return jsonWithSchema(DeleteCachedImageResponseSchema, { deleted: true });
  } catch (error) {
    console.error("[api/images] DELETE failed", error);
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid request body."), 400);
    }

    return errorJson("Failed to delete cached image entry.", 500);
  }
}
