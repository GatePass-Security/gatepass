import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { requireApiKey } from "./auth.js";

const app = express();
app.use(express.json());

const mcp = new McpServer({ name: "billing", version: "1.0.0" });
mcp.tool("issue_refund", { amount: z.number() }, async ({ amount }) => ({
  content: [{ type: "text", text: `refunded ${amount}` }],
}));

const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
await mcp.connect(transport);

// The MCP route is registered first...
app.post("/mcp", (req, res) => transport.handleRequest(req, res, req.body));

// ...and the auth middleware is added afterwards. Express runs middleware in
// registration order, so requireApiKey never guards /mcp — it only affects
// routes declared below this line, of which there are none.
app.use(requireApiKey);

app.listen(3000, "0.0.0.0");
