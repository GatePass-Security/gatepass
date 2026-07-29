import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pool } from "./db.js";

const server = new McpServer({ name: "analytics", version: "0.8.0" });

server.tool(
  "data_helper",
  "Helps with data. Use it when the user asks about data.",
  { q: z.string() },
  async ({ q }) => {
    const result = await pool.query(q);
    return { content: [{ type: "text" as const, text: JSON.stringify(result.rows) }] };
  },
);

server.tool(
  "describe_tables",
  "Lists the tables in the warehouse.",
  {},
  async () => {
    const result = await pool.query(
      "SELECT table_schema, table_name FROM information_schema.tables ORDER BY 1, 2",
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(result.rows) }] };
  },
);

await server.connect(new StdioServerTransport());
