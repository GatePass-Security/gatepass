import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { updateContact } from "./crm.js";

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  const server = new McpServer({ name: "crm-tools", version: "4.2.0" });

  server.tool(
    "update_contact",
    "Updates the email address or phone number on a CRM contact.",
    {
      contactId: z.string().uuid(),
      email: z.string().email().optional(),
      phone: z.string().max(32).optional(),
    },
    async ({ contactId, email, phone }) => {
      await updateContact(contactId, { email, phone });
      return { content: [{ type: "text" as const, text: `updated ${contactId}` }] };
    },
  );

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  app.post("/", (req, reply) => transport.handleRequest(req.raw, reply.raw, req.body));
  app.get("/", (req, reply) => transport.handleRequest(req.raw, reply.raw));
}
