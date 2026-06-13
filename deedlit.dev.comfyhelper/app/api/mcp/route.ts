import { NextResponse } from "next/server";

import { getLibraryConfig } from "@/lib/library/config";
import { handleMcpBody } from "@/lib/library/mcp/server";
import { MCP_TOOLS } from "@/lib/library/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP-over-HTTP endpoint (stateless JSON-RPC).  External LLMs/agents connect
 * here to call the image-library tools.  Security is intentionally open for v1;
 * the tool boundary is the seam where auth will later be added.
 */
export async function POST(request: Request) {
  if (!getLibraryConfig().mcpEnabled) {
    return NextResponse.json({ error: "MCP is disabled (set MCP_ENABLED=true)." }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }
  const response = await handleMcpBody(body);
  if (response === null) {
    return new NextResponse(null, { status: 202 });
  }
  return NextResponse.json(response);
}

/** Convenience discovery endpoint: list available tools without JSON-RPC. */
export async function GET() {
  if (!getLibraryConfig().mcpEnabled) {
    return NextResponse.json({ error: "MCP is disabled (set MCP_ENABLED=true)." }, { status: 403 });
  }
  return NextResponse.json({
    server: "comfyhelper-image-library",
    transport: "http-jsonrpc",
    tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
  });
}
