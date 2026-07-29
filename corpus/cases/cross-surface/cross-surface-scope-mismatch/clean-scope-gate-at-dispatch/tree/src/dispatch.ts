import manifest from "../mcp/server.json";
import { operations } from "./operations";

// The single source of truth is the manifest this server was installed with.
const granted = new Set<string>(manifest.grantedScopes);

/** Only tools whose required scopes were actually granted are advertised. */
export function availableTools(): string[] {
  return Object.entries(operations)
    .filter(([, op]) => op.requiredScopes.every((scope) => granted.has(scope)))
    .map(([name]) => name);
}

export async function dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
  const op = operations[name];
  if (!op) {
    throw new Error(`unknown tool: ${name}`);
  }

  const missing = op.requiredScopes.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    // The installation never granted these, so refuse rather than attempt a
    // call the app has no authority to make.
    throw new Error(`tool ${name} requires ungranted scopes: ${missing.join(", ")}`);
  }

  return op.run(args);
}
