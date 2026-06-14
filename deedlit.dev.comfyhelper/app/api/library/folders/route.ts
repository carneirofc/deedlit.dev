import { handleRoute, jsonError, jsonOk } from "@/lib/library/http";
import { createSourceFolder, listSourceFolders } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The configured source-folder registry. GET lists folders (with derived
 * image/label coverage); POST registers a new one. Both proxy the gateway
 * /folders routes (catalog owns the data). Returns `{ folders }` so the admin
 * panel can poll a stable shape.
 */
export async function GET() {
  return handleRoute(async () => {
    const folders = await listSourceFolders();
    return jsonOk({ folders });
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = (await request.json()) as { path?: unknown };
    if (typeof body.path !== "string" || body.path.trim() === "") {
      return jsonError("A folder path is required.", 400);
    }
    const folder = await createSourceFolder(body as Parameters<typeof createSourceFolder>[0]);
    return jsonOk(folder, { status: 201 });
  });
}
