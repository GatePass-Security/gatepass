import type { Detector, DetectorFinding, ScanContext } from "@gatepass/engine";

/**
 * Verified detector: an MCP server transport bound to a network interface with no
 * authentication configured anywhere in the server file. Deterministically checkable from
 * the config/impl surface.
 *
 * Auth is detected at file scope (not in a window around the bind) because MCP auth
 * middleware is typically registered once at server setup, often far from `listen()`.
 * Comment lines are excluded — a comment mentioning "auth" does not implement it.
 */

/*
 * A bind is a *call that starts serving*, not a mention of the word "transport".
 *
 * The earlier version matched `createServer(` anywhere, bare `.listen(`, and
 * `transport[:=]sse|http|streamable`. Measured against forty public repositories that produced
 * a false positive rate near one in two, and the causes are worth naming because each is a
 * different mistake:
 *
 *  - `createServer(` matched any local factory of that name — including one that returns an
 *    in-process object and never touches a socket.
 *  - `.listen(` matched prose: `client.listen(tools_list_changed=True)` inside a Python
 *    docstring, and deprecation strings pointing readers at `Client.listen()`.
 *  - `transport: StreamableHTTPServerTransport,` is a TypeScript parameter type, and
 *    `transport = StreamableHTTPTransport(url)` is a *client* opening a connection. Neither
 *    listens for anything.
 *
 * So each alternative now requires call syntax and, where the word alone is ambiguous, a string
 * literal naming a server transport.
 */
const NETWORK_BIND = new RegExp(
  [
    // Bound to every interface — unambiguous regardless of framework.
    /host\s*[:=]\s*['"]0\.0\.0\.0['"]/.source,
    /*
     * `http.createServer(...)` is deliberately NOT here. Constructing a server object binds
     * nothing — the bind is the `.listen(...)` below, and treating the constructor as one
     * reported every test that spins a throwaway server on an ephemeral port. LibreChat and
     * n8n contributed fourteen such findings between them, all in `__tests__`, none reachable
     * from anywhere. If it never listens, it is not a transport.
     */
    // `app.listen(` / `server.listen(` — a receiver, then a call. Excludes bare `listen(` in
    // prose because a docstring line rarely carries `<identifier>.listen(` followed by a port
    // or options object. A numeric argument must look like a port (four digits or more):
    // `s.listen(1)` is a socket accept-backlog, not a server coming up, and reading it as one
    // reported a test helper on strands-agents/sdk-python as an exposed transport.
    /\b[A-Za-z_$][\w$]*\s*\.\s*listen\s*\(\s*(?:[{('"]|\d{4,})/.source,
    // Python/FastMCP: `mcp.run(transport="sse")`, `uvicorn.run(...)`, `app.run_sse_async(`.
    /\.\s*run(?:_\w+)?\s*\(\s*[^)]*transport\s*=\s*['"](?:sse|http|streamable[-_]http)['"]/.source,
    /\buvicorn\s*\.\s*run\s*\(/.source,
  ].join("|"),
  "i",
);

/**
 * Type annotations, which look like assignments and are not.
 *
 * `transport: StreamableHTTPServerTransport,` and `_default_transport: Transport = "http"` both
 * declare a shape. A capitalised right-hand side is a type name, never a bind.
 */
const TYPE_ANNOTATION = /^\s*(?:private\s+|readonly\s+|public\s+)*[\w$]+\s*[:=]\s*[A-Z][\w.]*(?:\s*[,;)]|\s*=|$)/;

/**
 * A server pinned to loopback is not on the network.
 *
 * `uvicorn.run(app, host="127.0.0.1", port=8000)` is reachable only from the machine it runs
 * on, so "exposed on the network, no authentication" is simply false about it — and the fix the
 * finding asks for is work with no risk behind it. Observed on strands-agents/sdk-python, whose
 * integration-test servers all bind loopback deliberately.
 */
const LOOPBACK = /\b(?:127\.0\.0\.1|localhost|::1)\b/i;

const AUTH_CONSTRUCT =
  /(authorization|bearer|apikey|api_key|requireauth|require_auth|requirebearer|verifytoken|verify_token|\.use\([^)]*auth|middleware.*auth|getToken|\btoken\s*[:(])/i;

/**
 * Remove what is not code: line comments, and Python/JS multi-line string bodies.
 *
 * Docstrings were the largest single source of false positives — the official MCP Python SDK
 * documents `Client.listen()` in prose, and every mention read as an unauthenticated transport.
 * A docstring is documentation about code, not code, and a scanner that cannot tell the
 * difference reports a library's own reference material as a vulnerability.
 */
function stripNonCode(content: string): string {
  // Triple-quoted Python strings and JS template literals, replaced by blank lines so that
  // every subsequent line number is unchanged.
  const blanked = content.replace(/("""|''')[\s\S]*?\1/g, (m) => m.replace(/[^\n]/g, " "));
  return blanked
    .split(/\r?\n/)
    .map((l) => {
      const t = l.trim();
      return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("#") ? "" : l;
    })
    .join("\n");
}

export const unauthMcpTransportDetector: Detector = {
  classIds: ["unauth-mcp-transport"],
  tier: "verified",
  run(ctx: ScanContext): DetectorFinding[] {
    const findings: DetectorFinding[] = [];
    for (const file of ctx.files) {
      if (!file.surfaces.includes("mcp_server")) continue;
      /*
       * A client is not a server. `src/mcp/client/streamable_http.py` opens a connection *to*
       * an MCP server; reporting it as an exposed transport inverts the direction of the risk,
       * and the surface classifier cannot tell the two apart because both live under `mcp/`.
       */
      if (/(^|\/)clients?(\/|\.)/.test(file.relPath.toLowerCase())) continue;

      const codeOnly = stripNonCode(file.content);
      if (AUTH_CONSTRUCT.test(codeOnly)) continue; // server registers auth somewhere

      const lines = codeOnly.split(/\r?\n/);
      lines.forEach((text, i) => {
        if (!NETWORK_BIND.test(text)) return;
        if (TYPE_ANNOTATION.test(text)) return;
        if (LOOPBACK.test(text)) return;
        const line = i + 1;
        findings.push({
          tier: "verified",
          classId: "unauth-mcp-transport",
          severity: "high",
          surfaces: file.surfaces,
          locations: [{ path: file.relPath, startLine: line, endLine: line, surface: "mcp_server" }],
          explanation:
            `MCP server transport in ${file.relPath}:${line} is exposed on the network, and no ` +
            `authentication construct is registered anywhere in this server file.`,
          reproduction: {
            kind: "inspection",
            steps: [
              `Open ${file.relPath} at line ${line}.`,
              `Note the network transport binding.`,
              `Search the file for auth/bearer/token middleware — none is present.`,
            ],
            expected: `The MCP transport accepts unauthenticated connections.`,
          },
        });
      });
    }
    return findings;
  },
};
