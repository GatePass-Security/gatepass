import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { migrationTool, runMigration, type MigrationInput } from "./tools/migration-tool.js";

const server = new Server(
  { name: "ops-migrations", version: "0.3.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [migrationTool],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== migrationTool.name) {
    throw new Error(`unknown tool: ${request.params.name}`);
  }
  const output = runMigration(request.params.arguments as unknown as MigrationInput);
  return { content: [{ type: "text", text: output }] };
});

await server.connect(new StdioServerTransport());
