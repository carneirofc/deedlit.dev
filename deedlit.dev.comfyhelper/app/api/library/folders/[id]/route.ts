import { handleRoute, jsonOk } from "@/lib/library/http";
import { deleteSourceFolder, updateSourceFolder } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Update a folder's controls (enabled / recursive / interval / label). */
export async function PATCH(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { id } = await context.params;
    const body = (await request.json()) as Parameters<typeof updateSourceFolder>[1];
    const folder = await updateSourceFolder(id, body);
    return jsonOk(folder);
  });
}

/** Remove a folder from the registry (does NOT delete its cataloged images). */
export async function DELETE(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { id } = await context.params;
    await deleteSourceFolder(id);
    return jsonOk({ status: "ok" });
  });
}
