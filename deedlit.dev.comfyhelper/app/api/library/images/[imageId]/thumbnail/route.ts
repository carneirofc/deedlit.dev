import { handleRoute, jsonError } from "@/lib/library/http";
import { blobUrl } from "@/lib/api-client";
import { getCachedImage, setCachedImage, warmOriginal } from "@/lib/library/image-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ imageId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { imageId } = await context.params;

    const cached = await getCachedImage(imageId, "thumb");
    if (cached) {
      warmOriginal(imageId);
      return new Response(cached.data as unknown as BodyInit, {
        headers: {
          "cache-control": "public, max-age=86400",
          "content-type": cached.contentType,
        },
      });
    }

    const upstream = blobUrl(imageId, "thumbnail");
    if (!upstream) return jsonError("Thumbnail serving is not configured (set DEEDLIT_BLOB_URL).", 404);

    const res = await fetch(upstream, { cache: "no-store" });
    if (!res.ok || !res.body) return jsonError("Thumbnail not found.", res.status === 404 ? 404 : 502);

    const ct = res.headers.get("content-type") ?? "image/webp";
    const buf = Buffer.from(await res.arrayBuffer());

    setCachedImage(imageId, "thumb", buf, ct).catch(() => {});
    warmOriginal(imageId);

    return new Response(buf as unknown as BodyInit, {
      headers: {
        "cache-control": "public, max-age=86400",
        "content-type": ct,
      },
    });
  });
}
