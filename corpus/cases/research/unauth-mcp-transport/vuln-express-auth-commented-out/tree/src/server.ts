import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { requestLogger } from "./logging.js";
// import { requireBearer } from "./auth.js";

const server = new McpServer({ name: "deploy-bot", version: "1.6.0" });

server.tool(
  "restart_service",
  "Restarts one service in the staging cluster.",
  { service: z.enum(["api", "worker", "scheduler"]) },
  async ({ service }) => {
    await fetch(`http://orchestrator.internal/restart/${service}`, { method: "POST" });
    return { content: [{ type: "text" as const, text: `restarting ${service}` }] };
  },
);

const app = express();
app.use(express.json());
app.use(requestLogger);
// TODO(INFRA-2291): re-enable once the auth gateway sits in front of this service.
// app.use("/mcp", requireBearer);

const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
await server.connect(transport);

app.post("/mcp", (req, res) => transport.handleRequest(req, res, req.body));
app.get("/mcp", (req, res) => transport.handleRequest(req, res));

app.listen(3000, "0.0.0.0", () => {
  console.log("deploy-bot mcp listening on 0.0.0.0:3000");
});
