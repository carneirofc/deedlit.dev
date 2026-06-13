import { NextResponse } from "next/server";

import { mcpRpc } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP-over-HTTP endpoint. comfyhelper is UI-only; the MCP tool surface now lives
 * in the deedlit.api gateway (deedlit.api/mcp.py). This route is a thin proxy
 * that forwards JSON-RPC bodies to the gateway's POST /mcp and relays the reply.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }
  const response = await mcpRpc(body);
  if (response === null || response === undefined) {
    return new NextResponse(null, { status: 202 });
  }
  return NextResponse.json(response);
}

/** Discovery: list the gateway's MCP tools without JSON-RPC framing. */
export async function GET() {
  const res = (await mcpRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as {
    result?: { tools?: Array<{ name: string; description: string }> };
  };
  return NextResponse.json({
    server: "comfyhelper-image-library",
    transport: "http-jsonrpc",
    proxiedTo: "deedlit.api",
    tools: (res?.result?.tools ?? []).map((t) => ({ name: t.name, description: t.description })),
  });
}
