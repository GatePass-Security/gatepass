import type { Surface } from "@gatepass/findings";
import path from "node:path";

/**
 * Surface classification. A single repo file may belong to multiple surfaces (e.g. an
 * MCP server file is both `mcp_server` and `agent_code`). Cross-surface correlation
 * (Principle IV) depends on this map being multi-valued rather than exclusive.
 */
export function classifySurfaces(relPath: string): Surface[] {
  const p = relPath.replace(/\\/g, "/").toLowerCase();
  const base = path.posix.basename(p);
  const surfaces = new Set<Surface>();

  // Tool definitions / MCP configuration
  if (base === "mcp.json" || base.endsWith(".mcp.json") || /(^|\/)tools?\.(json|ya?ml)$/.test(p)) {
    surfaces.add("tool_defs");
    surfaces.add("mcp_server");
  }
  // Permission / policy scopes
  if (/(permissions?|scopes?|policy|rbac)\.(json|ya?ml|toml)$/.test(p)) {
    surfaces.add("permission_scopes");
  }
  // Firebase security rules declare who may read and write each collection — an authorization
  // policy, not application code. Matched by canonical filename rather than the bare `.rules`
  // extension, which other tools (Prometheus alerting rules) use for something unrelated; those
  // keep the app_code fallback. Without this the most tenancy-critical file in a Firebase project
  // classifies only by the "nothing matched" default, so cross-surface analysis (Principle IV)
  // cannot find the declared policy to correlate actual data access against.
  if (base === "firestore.rules" || base === "storage.rules" || base === "database.rules.json") {
    surfaces.add("permission_scopes");
  }
  // MCP server implementation — keyed off an mcp/agent directory or an mcp-prefixed
  // filename, NOT any file merely named "server" (a generic HTTP server is not an MCP
  // server; that over-broad match caused false positives).
  const segments = p.split("/");
  const inAgentDir = segments.some((s) => s === "mcp" || s === "agent" || s === "agents");
  const mcpNamed = /(^|\/)mcp[^/]*\.(ts|js|py|go)$/.test(p);
  if (inAgentDir || mcpNamed) {
    surfaces.add("mcp_server");
    surfaces.add("agent_code");
  }
  // Everything with source code is at least app_code
  if (/\.(ts|tsx|js|jsx|py|go|sql)$/.test(p)) {
    surfaces.add("app_code");
  }
  // Built/bundled artifacts are app_code (where exposed secrets live)
  if (/\.(js|map)$/.test(p) && (p.includes("dist/") || p.includes("build/") || p.includes(".next/"))) {
    surfaces.add("app_code");
  }

  if (surfaces.size === 0) surfaces.add("app_code");
  return [...surfaces];
}
