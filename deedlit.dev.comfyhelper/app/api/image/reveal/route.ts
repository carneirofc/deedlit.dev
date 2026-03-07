import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

import { ZodError } from "zod";

import { RevealImageBodySchema, RevealImageResponseSchema } from "@/lib/contracts/api";
import { errorJson, jsonWithSchema, zodErrorMessage } from "@/lib/http/route-response";
import { loadVisibleRootsContext } from "@/lib/http/route-context";
import { isAllowedImagePath } from "@/lib/library-scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { path: requestedPath } = RevealImageBodySchema.parse(payload);

    const { roots } = await loadVisibleRootsContext();
    if (!isAllowedImagePath(requestedPath, roots)) {
      return errorJson("Image path is not allowed.", 403);
    }

    try {
      const fileStats = await stat(requestedPath);
      if (!fileStats.isFile()) {
        return errorJson("Image path does not point to a file.", 404);
      }
    } catch {
      return errorJson("Image file not found.", 404);
    }

    const platform = process.platform;
    if (platform === "win32") {
      // On Windows: open Explorer and select the file
      await execFileAsync("explorer", [`/select,${requestedPath}`]);
    } else if (platform === "darwin") {
      // On macOS: open Finder and reveal the file
      await execFileAsync("open", ["-R", requestedPath]);
    } else {
      // On Linux: open the containing directory
      await execFileAsync("xdg-open", [dirname(requestedPath)]);
    }

    return jsonWithSchema(RevealImageResponseSchema, { revealed: true });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorJson(zodErrorMessage(error, "Invalid image path."), 400);
    }
    return errorJson("Failed to reveal image in file explorer.", 500);
  }
}
