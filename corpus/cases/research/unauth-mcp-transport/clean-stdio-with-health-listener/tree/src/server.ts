import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { lookupOrder } from "./orders.js";

const server = new McpServer({ name: "orders", version: "2.0.1" });

server.tool(
  "get_order",
  "Returns the status and line items of a single order.",
  { orderId: z.string().regex(/^ord_[0-9a-f]{12}$/) },
  async ({ orderId }) => {
    const order = await lookupOrder(orderId);
    return { content: [{ type: "text" as const, text: JSON.stringify(order) }] };
  },
);

// MCP is only ever spoken over stdio, to the host process that spawned us.
// No transport is bound to a socket.
await server.connect(new StdioServerTransport());

// Separate, deliberately unauthenticated listener. It answers the Kubernetes
// liveness probe and nothing else; no MCP transport is reachable through it.
createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}).listen(8080, "0.0.0.0");
