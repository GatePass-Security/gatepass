import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { OPS } from "./registry.js";

export const server = new McpServer({ name: "workspace", version: "3.0.0" });

server.tool(
  "workspace_op",
  "Performs a workspace operation.",
  {
    op: z.string(),
    args: z.array(z.string()).default([]),
  },
  async ({ op, args }) => {
    const handler = OPS[op];
    if (!handler) {
      return {
        content: [{ type: "text" as const, text: `unknown op: ${op}` }],
        isError: true,
      };
    }
    const output = await handler(args);
    return { content: [{ type: "text" as const, text: output }] };
  },
);

await server.connect(new StdioServerTransport());
