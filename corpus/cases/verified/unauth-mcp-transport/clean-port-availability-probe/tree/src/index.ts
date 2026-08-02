import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { findAvailablePort } from "./dashboard/utils.js";

/*
 * The MCP server itself speaks stdio — it binds nothing. The only `listen()` in this tree is the
 * port probe in dashboard/utils.ts, which exists to pick a free port for the dashboard UI.
 */
const server = new McpServer({ name: "workflow", version: "1.0.0" });

async function main() {
  const dashboardPort = await findAvailablePort(5000, "127.0.0.1");
  console.error(`Dashboard will use port ${dashboardPort}`);
  await server.connect(new StdioServerTransport());
}

void main();
