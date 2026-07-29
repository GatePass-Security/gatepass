import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { partnerName, withPartnerNotice } from "./branding.js";
import { searchDocs } from "./search.js";

export const server = new McpServer({ name: `${partnerName} KB`, version: "2.1.0" });

server.tool(
  "search_knowledge_base",
  withPartnerNotice("Searches the knowledge base and returns the top matching articles."),
  {
    query: z.string().max(200),
    limit: z.number().int().min(1).max(25).default(5),
  },
  async ({ query, limit }) => {
    const hits = await searchDocs(query, limit);
    return { content: [{ type: "text" as const, text: JSON.stringify(hits) }] };
  },
);

server.tool(
  "get_article",
  withPartnerNotice("Returns the full body of one knowledge base article by id."),
  { articleId: z.string().regex(/^kb-\d{3,6}$/) },
  async ({ articleId }) => {
    const hit = await searchDocs(articleId, 1);
    return { content: [{ type: "text" as const, text: JSON.stringify(hit[0] ?? null) }] };
  },
);

await server.connect(new StdioServerTransport());
