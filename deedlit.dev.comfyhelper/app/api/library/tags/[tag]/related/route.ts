import { handleRoute, jsonOk } from "@/lib/library/http";
import { callMcpTool } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ tag: string }> };

interface RelatedTagRaw {
  tag?: string;
  name?: string;
  weight?: number;
  coOccurrence?: number;
}

/**
 * Tags co-occurring with a tag. Proxies to the gateway MCP tool
 * `find_related_tags` (-> deedlit.graph /related-tags) and maps the
 * { tag, weight } rows into the { name, coOccurrence } shape the UI renders.
 */
export async function GET(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { tag } = await context.params;
    const decoded = decodeURIComponent(tag);
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 20)));

    const tool = await callMcpTool("find_related_tags", { tag: decoded, limit });
    const structured = (tool.structuredContent ?? {}) as { related?: RelatedTagRaw[] };
    const related = (structured.related ?? []).map((r) => ({
      name: r.name ?? r.tag ?? "",
      coOccurrence: r.coOccurrence ?? r.weight ?? 0,
    }));
    return jsonOk({ tag: decoded, related });
  });
}
