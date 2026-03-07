import { EventBusHealthResponseSchema } from "@/lib/contracts/api";
import { errorJson, jsonWithSchema } from "@/lib/http/route-response";
import { getScanEventHealth } from "@/lib/messaging/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const health = getScanEventHealth();
    return jsonWithSchema(EventBusHealthResponseSchema, health);
  } catch {
    return errorJson("Failed to read event bus health.", 500);
  }
}
