import { z } from "zod";

import { getLogger } from "@/lib/logger";
import { MCP_TOOLS, getToolByName } from "@/lib/library/mcp/tools";

const logger = getLogger({ scope: "library-mcp" });

const PROTOCOL_VERSION = "2024-11-05";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function toolListPayload() {
  return {
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.schema, { target: "draft-7" }),
    })),
  };
}

/**
 * Stateless MCP-over-HTTP dispatcher.  Implements the JSON-RPC methods needed by
 * standard MCP clients (initialize, tools/list, tools/call, ping).  Notifications
 * (no id) return null so the route can answer 202 with no body.
 */
export async function handleMcpMessage(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;

  switch (message.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "comfyhelper-image-library", version: "0.1.0" },
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, toolListPayload());

    case "tools/call": {
      const params = message.params as { name?: string; arguments?: unknown } | undefined;
      const tool = params?.name ? getToolByName(params.name) : undefined;
      if (!tool) {
        return err(id, -32602, `unknown tool: ${params?.name ?? "(none)"}`);
      }
      try {
        const result = await tool.handler(params?.arguments ?? {});
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        logger.warn({ err: error, tool: params?.name }, "tool call failed");
        return ok(id, {
          content: [{ type: "text", text: `Error: ${messageText}` }],
          isError: true,
        });
      }
    }

    default:
      return err(id, -32601, `method not found: ${message.method}`);
  }
}

/** Handle a single message or a JSON-RPC batch. */
export async function handleMcpBody(body: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    const responses = await Promise.all(body.map((m) => handleMcpMessage(m as JsonRpcRequest)));
    const filtered = responses.filter((r): r is JsonRpcResponse => r !== null);
    return filtered.length > 0 ? filtered : null;
  }
  return handleMcpMessage(body as JsonRpcRequest);
}
