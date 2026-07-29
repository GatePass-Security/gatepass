import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { loadRegistry } from "internal-tool-registry";
import { z } from "zod";

const CallSchema = z.object({
  tool: z.string().min(1).max(128),
  args: z.record(z.unknown()).default({}),
});

export async function createGateway(name: string) {
  const registry = await loadRegistry();
  const server = new Server({ name, version: "0.6.3" }, { capabilities: { tools: {} } });

  server.setRequestHandler("tools/call", async (request) => {
    const { tool, args } = CallSchema.parse(request.params);
    const entry = registry.get(tool);
    if (!entry) throw new Error(`unknown tool: ${tool}`);
    return entry.invoke(args);
  });

  return server;
}
