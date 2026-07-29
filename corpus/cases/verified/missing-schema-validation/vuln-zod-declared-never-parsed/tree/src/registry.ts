import { zodToJsonSchema } from 'zod-to-json-schema';
import { deployTool } from './tools/deploy.js';
import type { ToolContext } from './types.js';

const tools = [deployTool];

/** Advertised to the client at handshake time. */
export function listTools() {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.schema),
  }));
}

export async function dispatch(name: string, args: unknown, ctx: ToolContext) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.handler(args as any, ctx);
}
