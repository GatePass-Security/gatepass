import type { Detector, DetectorFinding, ScanContext, ScanFile } from "@gatepass/engine";
import { lineAtIndex } from "@gatepass/engine";
import type { Severity, Surface } from "@gatepass/findings";
import { TEST_PATH } from "./paths.js";

/**
 * Verified detector: an MCP server whose transport is reachable over the network with no
 * authentication control that actually APPLIES to it.
 *
 * The general shape, not one framework's spelling:
 *
 *   1. The repository is an MCP server (content evidence: SDK imports, FastMCP, mcp-go,
 *      transport constructors, tool registration) — never inferred from the file path, because
 *      a Python `server.py` at the repo root is as much an MCP server as `mcp/server.ts`.
 *   2. Something binds that server to a network transport: `listen()`, `uvicorn.run`,
 *      `ListenAndServe`, `mcp.run(transport="sse"|"streamable-http")`, or an ASGI mount of
 *      `sse_app()`/`streamable_http_app()`. A stdio-only server is not exposed and is not a
 *      finding.
 *   3. No *effective* auth control covers it.
 *
 * Step 3 is where this detector earns its keep. The question is never "does auth-looking code
 * exist somewhere in this repo" — that is trivially satisfied by a `requireBearer` nobody
 * registered. The question is whether a control is APPLIED and REACHABLE:
 *
 *   - Comments are blanked before analysis: a commented-out `app.use(requireBearer)` is not a
 *     control.
 *   - A control registered only inside a config flag that defaults false, and that no shipped
 *     deployment config (compose file, Dockerfile, .env, k8s manifest) turns on, is not a
 *     control — the artefact as shipped runs without it.
 *   - A check on a forgeable request header (`X-Internal-Request`, `X-Forwarded-For`) is not
 *     authentication: it carries no secret, so the client can simply assert it. A control is
 *     credential-bearing only if it consults an actual credential (Authorization/Bearer, JWT,
 *     API key, session/cookie, HMAC signature).
 *   - Path scope matters in both directions. Auth applied to `/mcp` covers the MCP transport;
 *     auth applied to `/admin` does not. Conversely a deliberately public route that is NOT the
 *     MCP route (an RFC 9728 protected-resource metadata endpoint, a health check) does not make
 *     the server unauthenticated.
 *
 * Severity tracks blast radius: an all-interfaces bind (0.0.0.0, ::, empty host) is critical, a
 * loopback-only bind is medium.
 */

/* ------------------------------------------------------------------ language + comments */

type Lang = "js" | "py" | "go" | "data" | "other";

function langOf(relPath: string): Lang {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(relPath)) return "js";
  if (/\.py$/i.test(relPath)) return "py";
  if (/\.go$/i.test(relPath)) return "go";
  if (/\.(json|ya?ml|toml|ini|conf|env|tf)$/i.test(relPath)) return "data";
  return "other";
}

/**
 * Blank comment bodies while preserving every byte offset and line break, so a control that is
 * commented out disappears from the analysis but line numbers still point at real source.
 */
function blankComments(src: string, lang: Lang): string {
  if (lang !== "js" && lang !== "py" && lang !== "go") return src;
  const out = src.split("");
  const n = src.length;
  const py = lang === "py";
  let i = 0;
  while (i < n) {
    const c = src[i] ?? "";
    if (c === '"' || c === "'" || c === "`") {
      const triple = py && src.slice(i, i + 3) === c + c + c;
      const quote = triple ? c + c + c : c;
      let j = i + quote.length;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src.slice(j, j + quote.length) === quote) {
          j += quote.length;
          break;
        }
        if (!triple && src[j] === "\n") break;
        j++;
      }
      i = j;
      continue;
    }
    if (!py && c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (!py && c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) if (out[k] !== "\n") out[k] = " ";
      i = stop;
      continue;
    }
    if (py && c === "#") {
      while (i < n && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    i++;
  }
  return out.join("");
}

/* ------------------------------------------------------------------ tiny source scanner */

function skipString(src: string, i: number): number {
  const q = src[i] ?? "";
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src[j] === q) return j + 1;
    j++;
  }
  return j;
}

/** Balanced bracket read starting at an opener; returns the inner text and the closer index. */
function readBalanced(src: string, openIdx: number): { inner: string; end: number } | null {
  const open = src[openIdx];
  if (open !== "(" && open !== "[" && open !== "{") return null;
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i] ?? "";
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return { inner: src.slice(openIdx + 1, i), end: i };
    }
    i++;
  }
  return null;
}

function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < inner.length) {
    const c = inner[i] ?? "";
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(inner, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(inner.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function stringLiteralValue(expr: string): string | null {
  const m = /^(["'`])([\s\S]*)\1$/.exec(expr.trim());
  return m ? (m[2] ?? "") : null;
}

const RESERVED = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "None",
  "True",
  "False",
  "nil",
  "await",
  "async",
  "new",
  "return",
  "const",
  "let",
  "var",
  "function",
  "if",
  "else",
  "process",
  "env",
  "this",
  "self",
  "req",
  "res",
  "reply",
  "next",
  "err",
  "ctx",
  "context",
]);

function identifiersIn(text: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z_$][\w$]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = m[0];
    if (!RESERVED.has(id)) out.push(id);
  }
  return [...new Set(out)];
}

/* ------------------------------------------------------------------ vocabulary */

/** Content evidence that this repository implements an MCP server. */
const MCP_EVIDENCE =
  /(@modelcontextprotocol\/sdk|\bMcpServer\b|\bFastMCP\b|\bfastmcp\b|mcp\.server\b|modelcontextprotocol|mark3labs\/mcp-go|NewMCPServer\b|StreamableHTTPServerTransport|SSEServerTransport|NewStreamableHTTPServer|NewSSEServer|ServeStdio|StdioServerTransport|sse_app\s*\(|streamable_http_app\s*\(|@mcp\.tool|@server\.tool|mcp\.NewTool|\bAddTool\s*\(|\.registerTool\s*\(|"mcpServers"|list_tools\b)/;

/** Weaker, per-file link to the MCP server (covers entrypoints that only mount MCP routes). */
const MCP_MENTION = /\bmcp\b/i;

/** A transport that carries MCP over the network (as opposed to stdio). */
const NETWORK_TRANSPORT =
  /(StreamableHTTPServerTransport|SSEServerTransport|NewStreamableHTTPServer|NewSSEServer|sse_app\s*\(|streamable_http_app\s*\(|http_app\s*\(|transport\s*[:=]\s*["']?(sse|http|streamable[-_]?http)|["'](sse|streamable[-_]?http)["'])/i;

/**
 * Names that suggest a symbol is an authentication control. Used as a fallback when the symbol's
 * definition is not in the scanned tree (a control imported from a package, say).
 */
const AUTH_NAME =
  /(auth|bearer|jwt|oauth|oidc|token|apikey|api_key|credential|scope|session|login|signin|verify|verifier|passport|clerk|authorize|authorise|authenticate)/i;

/**
 * Evidence that a control actually consults a credential. A control must reach one of these to
 * count; "returns 401" on its own does not, because a forgeable-header gate also returns 401.
 */
const CREDENTIAL_SOURCE =
  /(authorization|\bbearer\b|jsonwebtoken|\bjwt\b|oauth|oidc|\bapi[_-]?key\b|x-api-key|access[_-]?token|id[_-]?token|refresh[_-]?token|\bsession\b|\bcookie\b|basic\s*auth|\bhmac\b|signature|client[_-]?secret|OAuth2PasswordBearer|HTTPBearer|APIKeyHeader|token_verifier|verify_token|ParseWithClaims|getToken|introspect)/i;

/**
 * Request headers a client can set at will. A gate that consults only these is not
 * authentication — it asserts trust rather than proving it.
 */
const FORGEABLE_HEADER =
  /(x-internal|x-forwarded-for|x-forwarded-host|x-real-ip|x-client-ip|x-originating-ip|x-requested-with|x-source|x-env|x-tenant-hint|x-admin\b|x-role\b|user-agent|referer|referrer)/i;

/**
 * Call sites where a middleware / dependency / handler wrapper is APPLIED. Registration is the
 * thing that matters: a control that is merely *defined* somewhere is not applied to anything.
 */
const METHOD_WIRING =
  /\.(use|useGlobal|addHook|register|addMiddleware|add_middleware|wrap|Use|Handle|HandleFunc|Group|With|before|preHandler|onRequest|route|guard)\s*\(/g;

/** Dependency-injection and constructor-argument shapes (FastAPI/Starlette/FastMCP, chi, hono). */
const CALL_WIRING = /\b(Depends|Security|Middleware|AuthMiddleware|RequiresScope|RequireScope|requireScope)\s*\(/g;

/** Keyword arguments that attach a control to a server or route. */
const KW_WIRING =
  /\b(dependencies|middleware|auth|authenticator|auth_provider|auth_server_provider|token_verifier|verifier|require_auth|authentication|security)\s*=\s*/g;

/** Reverse-proxy / gateway level auth, which no application-level pattern would see. */
const PROXY_AUTH = /(auth_request\s|auth_basic\s|oauth2-proxy|authRequired:\s*true|jwtAuth|requiredScopes)/;

/* ------------------------------------------------------------------ repo model */

interface Repo {
  files: ScanFile[];
  code: Map<string, string>;
  lang: Map<string, Lang>;
  /** Memoised symbol resolution and flag lookups — both are repo-wide and repeatedly asked. */
  defs: Map<string, string | null>;
  assigns: Map<string, string[]>;
}

function buildRepo(ctx: ScanContext): Repo {
  const code = new Map<string, string>();
  const lang = new Map<string, Lang>();
  for (const f of ctx.files) {
    const l = langOf(f.relPath);
    lang.set(f.relPath, l);
    code.set(f.relPath, blankComments(f.content, l));
  }
  return { files: ctx.files, code, lang, defs: new Map(), assigns: new Map() };
}

/** Body of a named function/const, wherever in the repo it is defined. */
function definitionBody(repo: Repo, name: string): string | null {
  const cached = repo.defs.get(name);
  if (cached !== undefined) return cached;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?(?:function|func|def|class)\\s+${escaped}\\b|(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\b\\s*[:=]|^\\s*${escaped}\\s*[:=]`,
    "m",
  );
  let found: string | null = null;
  for (const f of repo.files) {
    const src = repo.code.get(f.relPath) ?? "";
    const m = re.exec(src);
    if (!m) continue;
    const brace = src.indexOf("{", m.index);
    const bal = brace !== -1 && brace - m.index < 400 ? readBalanced(src, brace) : null;
    // Python (or a single-expression const) has no brace to balance: take a bounded slice.
    found = bal ? src.slice(m.index, bal.end + 1) : src.slice(m.index, m.index + 1200);
    break;
  }
  repo.defs.set(name, found);
  return found;
}

/** True when a symbol is a credential-bearing control (and not a forgeable-header gate). */
function isCredentialBearing(repo: Repo, symbol: string, inlineText: string): boolean {
  const body = definitionBody(repo, symbol);
  const haystack = body ?? "";
  if (CREDENTIAL_SOURCE.test(haystack) || CREDENTIAL_SOURCE.test(inlineText)) return true;
  if (body && FORGEABLE_HEADER.test(body)) return false; // asserts trust, proves nothing
  if (FORGEABLE_HEADER.test(inlineText) && !CREDENTIAL_SOURCE.test(inlineText)) return false;
  return AUTH_NAME.test(symbol); // control defined outside the scanned tree
}

/* ------------------------------------------------------------------ conditional reachability */

/** Indices of the `{` openers enclosing `offset`, outermost first. */
function enclosingBraces(code: string, offset: number): number[] {
  const stack: number[] = [];
  let i = 0;
  while (i < offset && i < code.length) {
    const c = code[i] ?? "";
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(code, i);
      continue;
    }
    if (c === "{") stack.push(i);
    else if (c === "}") stack.pop();
    i++;
  }
  return stack;
}

/** The `if (...)` condition guarding this offset, if any. */
function guardCondition(code: string, offset: number, lang: Lang): string | null {
  if (lang === "py") {
    const upto = code.slice(0, offset);
    const lines = upto.split(/\r?\n/);
    const cur = lines[lines.length - 1] ?? "";
    const indentOf = (l: string) => (/^\s*/.exec(l)?.[0] ?? "").length;
    let indent = indentOf(cur);
    for (let i = lines.length - 2; i >= 0; i--) {
      const l = lines[i] ?? "";
      if (!l.trim()) continue;
      const ind = indentOf(l);
      if (ind >= indent) continue;
      indent = ind;
      const m = /^\s*(?:el)?if\s+(.+?):\s*$/.exec(l);
      if (m) return m[1] ?? null;
      if (/^\s*(def|class|with|try|for|while|else|elif|except|finally)\b/.test(l)) return null;
    }
    return null;
  }
  for (const brace of enclosingBraces(code, offset).reverse()) {
    const head = code.slice(Math.max(0, brace - 300), brace);
    const m = /(?:^|[;{}\n])\s*(?:\}\s*else\s+)?if\s*\(([\s\S]*)\)\s*$/.exec(head);
    if (m) return m[1] ?? null;
    if (/(function|=>|func\s|\)\s*$)/.test(head.trimEnd().slice(-60))) return null;
  }
  return null;
}

/** RHS shapes that are OFF unless something explicitly turns them on. */
const DEFAULT_OFF =
  /(===?\s*["'](1|true|yes|on|enabled)["']|(\?\?|\|\|)\s*(false|["'](0|false|off|no|)["'])|=\s*false\b|getenv\s*\([^,)]+,\s*["'](0|false|off|no)["']\)|environ\.get\s*\([^,)]+,\s*["'](0|false|off|no)["']\))/i;

const ENV_READ =
  /(?:process\.env(?:\.(\w+)|\[\s*["'](\w+)["']\s*\])|(?:os\.)?(?:getenv|environ\.get|environ\[)\s*\(?\s*["'](\w+)["'])/;

/** Does any shipped deployment config actually set this flag to a truthy value? */
function flagEnabledInConfig(repo: Repo, flag: string): boolean {
  const re = new RegExp(`\\b${flag}\\b\\s*[:=]\\s*["']?(1|true|yes|on|enabled)\\b`, "i");
  for (const f of repo.files) {
    if (
      !/(docker-compose|dockerfile|\.env|\.ya?ml|\.yml|\.tf|\.ini|\.conf|procfile|makefile|package\.json|\.sh|\.toml)/i.test(
        f.relPath,
      )
    )
      continue;
    if (re.test(f.content)) return true;
  }
  return false;
}

/** A type annotation, not a value — `authRequired: boolean;` says nothing about the default. */
const TYPE_RHS = /^(string|number|boolean|bigint|any|unknown|never|null|undefined|void|bool|int\d*|float\d*)\b/;

/**
 * Every value assigned to `name` in the repo's PRODUCTION code (a type declaration must not
 * shadow it).
 *
 * Test and fixture paths are excluded deliberately. Both callers ask what the service does when
 * it runs, and a test is entitled to construct values the service never uses: a spec that builds
 * `bindAddress = "0.0.0.0"` to exercise a guard was enough to rate a production bind — defaulted
 * to `127.0.0.1`, behind a constructor that throws on any non-localhost address without an
 * explicit opt-in — as an all-interfaces CRITICAL. The same exclusion protects the auth-flag
 * check below from a fixture that turns the flag on.
 */
function assignmentsOf(repo: Repo, name: string): string[] {
  const cached = repo.assigns.get(name);
  if (cached !== undefined) return cached;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b\\s*[:=]\\s*([^,;\\n]+)`, "g");
  const out: string[] = [];
  for (const f of repo.files) {
    if (TEST_PATH.test(f.relPath)) continue;
    for (const m of (repo.code.get(f.relPath) ?? "").matchAll(re)) {
      const rhs = (m[1] ?? "").trim();
      if (!rhs || TYPE_RHS.test(rhs)) continue;
      out.push(rhs);
    }
  }
  repo.assigns.set(name, out);
  return out;
}

/**
 * Is the guard a config flag that ships OFF? Resolves identifiers one hop into their definitions
 * (`config.authRequired` -> `authRequired: process.env.MCP_AUTH === "1"`), then checks whether
 * anything in the deployment configuration turns the flag on.
 */
function guardShipsOff(repo: Repo, cond: string): { off: boolean; detail: string } {
  // A negated or inverted guard is not something we can reason about safely; assume it applies.
  if (/[!]|!==|!=|\bnot\b/.test(cond)) return { off: false, detail: "" };

  const check = (text: string, depth: number): { off: boolean; detail: string } => {
    if (DEFAULT_OFF.test(text)) {
      const env = ENV_READ.exec(text);
      const flag = env?.[1] ?? env?.[2] ?? env?.[3];
      if (flag && flagEnabledInConfig(repo, flag)) return { off: false, detail: "" };
      return {
        off: true,
        detail: flag
          ? `it is registered only when ${flag} is set, and no shipped configuration sets it`
          : `the flag it depends on defaults to off`,
      };
    }
    if (depth === 0) return { off: false, detail: "" };
    for (const id of identifiersIn(text).slice(0, 6)) {
      for (const rhs of assignmentsOf(repo, id)) {
        const r = check(rhs, depth - 1);
        if (r.off) return r;
      }
    }
    return { off: false, detail: "" };
  };

  return check(cond, 2);
}

/* ------------------------------------------------------------------ auth controls */

interface AuthControl {
  pathScope: string | null;
  where: string;
  line: number;
  /** Byte offset of the registration call, for ordering against the routes it claims to guard. */
  at: number;
  symbol: string;
  /**
   * True when the framework applies this control by *position in a chain* rather than by
   * matching a route table — `app.use(...)` in Express/connect/koa. For those, registration
   * order is part of the control's meaning; for a mux, a decorator or an ASGI middleware
   * stack it is not.
   */
  sequential: boolean;
  /** Applied unconditionally, or under a flag that ships on. */
  applies: boolean;
  offReason: string;
}

function collectAuthControls(repo: Repo): AuthControl[] {
  const controls: AuthControl[] = [];
  for (const f of repo.files) {
    const lang = repo.lang.get(f.relPath) ?? "other";
    const src = repo.code.get(f.relPath) ?? "";
    if (lang === "data") {
      if (PROXY_AUTH.test(src))
        controls.push({
          pathScope: null,
          where: f.relPath,
          line: lineAtIndex(f.content, Math.max(0, src.search(PROXY_AUTH))),
          at: Math.max(0, src.search(PROXY_AUTH)),
          symbol: "gateway",
          sequential: false,
          applies: true,
          offReason: "",
        });
      continue;
    }
    if (lang === "other") continue;

    /** One applied-control site: the args it was given, plus where to look for a route path. */
    const sites: { at: number; args: string[]; explicitPath: string | null; sequential: boolean }[] = [];

    for (const re of [METHOD_WIRING, CALL_WIRING]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const openIdx = src.indexOf("(", m.index);
        const bal = openIdx === -1 ? null : readBalanced(src, openIdx);
        if (!bal) continue;
        const args = splitTopLevel(bal.inner);
        if (args.length === 0) continue;
        // A leading route path scopes the control; a hook name ("onRequest") does not.
        const firstLit = stringLiteralValue(args[0] ?? "");
        const explicitPath = firstLit !== null && /^([/*]|https?:)/.test(firstLit) ? firstLit : null;
        sites.push({
          at: m.index,
          args: explicitPath === null ? args : args.slice(1),
          explicitPath,
          sequential: /^use/i.test(m[1] ?? ""),
        });
      }
    }

    KW_WIRING.lastIndex = 0;
    let k: RegExpExecArray | null;
    while ((k = KW_WIRING.exec(src)) !== null) {
      const from = k.index + k[0].length;
      const value = splitTopLevel(src.slice(from, from + 400))[0] ?? "";
      if (!value) continue;
      // `Mount("/mcp", app=..., middleware=[...])` — the guarded path sits earlier in the call.
      const back = src.slice(Math.max(0, k.index - 200), k.index);
      const pathHit = /["'](\/[^"']*)["'][^"']*$/.exec(back);
      sites.push({ at: k.index, args: [value], explicitPath: pathHit?.[1] ?? null, sequential: false });
    }

    for (const site of sites) {
      const rest = site.args.join(", ");
      const authSymbols = identifiersIn(rest).filter((s) => AUTH_NAME.test(s));
      const inlineCredential = CREDENTIAL_SOURCE.test(rest);
      const symbol = authSymbols.find((s) => isCredentialBearing(repo, s, rest));
      if (!symbol && !(inlineCredential && authSymbols.length === 0)) continue;

      const cond = guardCondition(src, site.at, lang);
      const gated = cond ? guardShipsOff(repo, cond) : { off: false, detail: "" };
      controls.push({
        pathScope: site.explicitPath,
        where: f.relPath,
        line: lineAtIndex(f.content, site.at),
        at: site.at,
        symbol: symbol ?? "inline credential check",
        sequential: site.sequential,
        applies: !gated.off,
        offReason: gated.detail,
      });
    }
  }
  return controls;
}

/* ------------------------------------------------------------------ registration order */

/**
 * Where the MCP transport is attached to a route.
 *
 * Presence of a control is not the same as the control running. In a chain-ordered framework
 * — Express and everything built on connect — `app.use(gate)` guards only the routes declared
 * *after* it, because the router walks the stack in registration order and a route handler that
 * was pushed earlier answers and ends the request before the chain ever reaches the gate. So a
 * repository can contain a correct, credential-bearing middleware, registered on the app, that
 * nevertheless never sees a single MCP request.
 *
 * That makes ordering part of "is this control effective?", not a stylistic detail: it is the
 * same class of bug as a commented-out `app.use`, and it is harder to see in review because the
 * line is right there in the file.
 */
const ROUTE_REGISTRATION = /\.\s*(get|post|put|patch|delete|options|head|all)\s*\(/g;

/** The MCP transport's own request handler, whatever the route path is spelled. */
const TRANSPORT_HANDOFF = /(handleRequest|handle_request|sse_app|streamable_http_app|http_app)\s*\(/;

function isMcpPath(literal: string | null, targets: string[]): boolean {
  if (literal === null || !literal.startsWith("/")) return false;
  const norm = (p: string) => p.replace(/\/+$/, "") || "/";
  return /(^|\/)mcp(\/|$)/i.test(literal) || targets.some((t) => norm(t) === norm(literal));
}

/** Offsets, per file, at which a route serving the MCP transport is registered. */
function mcpRouteSites(repo: Repo, targets: string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const f of repo.files) {
    if ((repo.lang.get(f.relPath) ?? "other") !== "js") continue;
    const src = repo.code.get(f.relPath) ?? "";
    const offsets: number[] = [];
    ROUTE_REGISTRATION.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ROUTE_REGISTRATION.exec(src)) !== null) {
      const openIdx = src.indexOf("(", m.index);
      const bal = openIdx === -1 ? null : readBalanced(src, openIdx);
      if (!bal) continue;
      const args = splitTopLevel(bal.inner);
      if (args.length < 2) continue; // a route needs a path and a handler
      if (isMcpPath(stringLiteralValue(args[0] ?? ""), targets) || TRANSPORT_HANDOFF.test(bal.inner))
        offsets.push(m.index);
    }
    if (offsets.length > 0) out.set(f.relPath, offsets);
  }
  return out;
}

/**
 * Does a chain-ordered control actually sit in front of the MCP route? Only same-file ordering
 * is decidable from source position — a control registered in another module may be applied
 * anywhere in the chain, so it is given the benefit of the doubt.
 */
function runsBeforeMcpRoute(control: AuthControl, routes: Map<string, number[]>): boolean {
  if (!control.sequential) return true;
  const offsets = routes.get(control.where);
  if (!offsets || offsets.length === 0) return true;
  return offsets.every((o) => o > control.at);
}

/* ------------------------------------------------------------------ exposure sites */

interface Exposure {
  file: ScanFile;
  line: number;
  offset: number;
  evidence: string;
  host: string | null;
  /** Secondary evidence lines in the same file. */
  support: { line: number; text: string }[];
}

const BIND_PATTERNS: { lang: Lang | "any"; re: RegExp; label: string }[] = [
  { lang: "js", re: /\.listen\s*\(/g, label: "listen()" },
  { lang: "py", re: /uvicorn\.run\s*\(/g, label: "uvicorn.run()" },
  { lang: "py", re: /\bhypercorn\b[\s\S]{0,40}?serve\s*\(/g, label: "hypercorn serve()" },
  {
    lang: "py",
    re: /\.run\s*\(\s*(?:transport\s*=\s*["'](?:sse|streamable[-_]?http|http)["']|host\s*=)/g,
    label: "run(network transport)",
  },
  { lang: "py", re: /run_(?:sse|streamable_http)_async\s*\(/g, label: "async network transport" },
  {
    lang: "py",
    re: /\.mount\s*\(\s*["'][^"']*["']\s*,\s*[^)]*(?:sse_app|streamable_http_app|http_app)\s*\(/g,
    label: "ASGI mount of the MCP app",
  },
  { lang: "go", re: /ListenAndServe(?:TLS)?\s*\(/g, label: "ListenAndServe()" },
  { lang: "go", re: /\.Start\s*\(\s*[^)]*\)/g, label: "Start(addr)" },
];

const ALL_INTERFACES = /(^|["'\s=:])(0\.0\.0\.0|::|\*)(["'\s:,)]|$)/;
const LOOPBACK = /(127\.0\.0\.1|localhost|::1)/i;

/**
 * Is this bind a probe rather than a service?
 *
 * A socket that is closed inside its own listen callback never serves a request: the canonical
 * "is this port free" helper opens one, learns the answer and closes it before anything can
 * connect. Nothing is exposed, so there is nothing for authentication to be missing from.
 *
 * Checked against the receiver by name so that `server.listen(p, h, () => { server.close() })`
 * is recognised while an unrelated `other.close()` in the same callback is not. Without this the
 * probe reached the finding list, and a display string containing the word MCP elsewhere in the
 * file was enough to rate it CRITICAL — see the clean-port-availability-probe case.
 */
function isProbeBind(src: string, matchIndex: number, args: string): boolean {
  const before = src.slice(Math.max(0, matchIndex - 120), matchIndex);
  const receiver = /([A-Za-z_$][\w$]*)\s*$/.exec(before)?.[1];
  if (!receiver) return false;
  return new RegExp(`\\b${receiver}\\s*\\.\\s*close\\s*\\(`).test(args);
}

function hostFromArgs(repo: Repo, args: string): string | null {
  if (ALL_INTERFACES.test(args)) return "0.0.0.0";
  if (LOOPBACK.test(args)) return "127.0.0.1";
  // `host: config.host` — resolve one hop.
  const ref = /host\s*[:=]\s*([\w.$]+)/i.exec(args);
  const leaf = ref?.[1]?.split(".").pop() ?? "";
  if (leaf && !/^\d/.test(leaf)) {
    for (const rhs of assignmentsOf(repo, leaf)) {
      if (ALL_INTERFACES.test(rhs)) return "0.0.0.0";
      if (LOOPBACK.test(rhs)) return "127.0.0.1";
    }
  }
  return null;
}

/**
 * Any deployment config that pins the bind address (compose, Dockerfile CMD, k8s).
 *
 * The address has to be *assigned* to something host-shaped. The previous last alternative was a
 * bare `0.0.0.0`, which matched the address wherever it appeared — including the line
 * `# Optional: 0.0.0.0:5000:5000 exposes to all interfaces (use with caution)`, a comment warning
 * against the very thing it was then read as evidence of. Comment lines are skipped for the same
 * reason: documenting an option is not selecting it.
 */
const DEPLOY_BINDS_ALL = /(?:--host[= ]+|\b[A-Z_]*(?:HOST|BIND(?:_?ADDRESS)?)[A-Z_]*\s*[:=]\s*["']?)0\.0\.0\.0\b/;

function hostFromDeployConfig(repo: Repo): string | null {
  for (const f of repo.files) {
    if (!/(docker-compose|dockerfile|\.ya?ml|\.tf|procfile|\.env)/i.test(f.relPath)) continue;
    for (const raw of f.content.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith("#") || line.startsWith("//")) continue;
      if (DEPLOY_BINDS_ALL.test(line)) return "0.0.0.0";
    }
  }
  return null;
}

function findExposures(repo: Repo, mcpFiles: Set<string>): Exposure[] {
  const out: Exposure[] = [];
  for (const f of repo.files) {
    const lang = repo.lang.get(f.relPath) ?? "other";
    if (lang !== "js" && lang !== "py" && lang !== "go") continue;
    const src = repo.code.get(f.relPath) ?? "";
    if (!mcpFiles.has(f.relPath) && !MCP_MENTION.test(src)) continue;

    let best: Exposure | null = null;
    const support: { line: number; text: string }[] = [];

    for (const pat of BIND_PATTERNS) {
      if (pat.lang !== lang) continue;
      const re = new RegExp(pat.re.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const paren = src.indexOf("(", m.index);
        const bal = paren === -1 ? null : readBalanced(src, paren);
        const args = bal?.inner ?? "";
        const line = lineAtIndex(f.content, m.index);
        if (pat.lang === "js" && isProbeBind(src, m.index, args)) continue;
        const host = hostFromArgs(repo, args);
        const mountsMcp = /(sse_app|streamable_http_app|http_app)\s*\(/.test(m[0] + args);
        const cand: Exposure = { file: f, line, offset: m.index, evidence: pat.label, host, support: [] };
        // Prefer the site that names the MCP transport; it is the precise place auth is missing.
        if (!best || (mountsMcp && !/mount/i.test(best.evidence))) {
          if (best) support.push({ line: best.line, text: best.evidence });
          best = cand;
        } else {
          support.push({ line, text: pat.label });
        }
      }
    }
    if (!best) continue;

    // Network transport must actually be in play (a stdio server binds nothing).
    const netEvidence = NETWORK_TRANSPORT.test(src);
    const stdioOnly = /(StdioServerTransport|ServeStdio|transport\s*=\s*["']stdio["'])/.test(src) && !netEvidence;
    if (stdioOnly) continue;

    best.support = support;
    best.host = best.host ?? hostFromDeployConfig(repo);
    out.push(best);
  }
  return out;
}

/* ------------------------------------------------------------------ coverage */

/** Route paths the MCP transport is served on. */
function mcpPaths(repo: Repo): string[] {
  const paths = new Set<string>();
  for (const f of repo.files) {
    const src = repo.code.get(f.relPath) ?? "";
    for (const line of src.split(/\r?\n/)) {
      const strings = [...line.matchAll(/["'`]([^"'`\n]{1,80})["'`]/g)].map((m) => m[1] ?? "");
      const mcpish =
        /(sse_app|streamable_http_app|http_app|transport\.handleRequest|StreamableHTTP|SSEServer|mcpRoutes|prefix)/.test(
          line,
        );
      for (const s of strings) {
        if (!s.startsWith("/")) continue;
        if (mcpish || /(^|\/)mcp(\/|$)/i.test(s)) paths.add(s);
      }
    }
  }
  return [...paths];
}

function covers(scope: string | null, targets: string[]): boolean {
  if (scope === null) return true; // global control
  if (targets.length === 0) return true; // cannot localise the MCP route; assume covered
  const norm = (p: string) => p.replace(/\/+$/, "") || "/";
  const s = norm(scope);
  return targets.some((t) => {
    const n = norm(t);
    return n === s || n.startsWith(s === "/" ? "/" : s + "/") || s.startsWith(n === "/" ? "/" : n + "/");
  });
}

/* ------------------------------------------------------------------ detector */

function uniqueSurfaces(file: ScanFile): Surface[] {
  return [...new Set<Surface>([...file.surfaces, "mcp_server"])];
}

export const unauthMcpTransportDetector: Detector = {
  classIds: ["unauth-mcp-transport"],
  tier: "verified",
  run(ctx: ScanContext): DetectorFinding[] {
    const repo = buildRepo(ctx);

    const mcpFiles = new Set<string>();
    for (const f of repo.files) {
      if (MCP_EVIDENCE.test(repo.code.get(f.relPath) ?? "")) mcpFiles.add(f.relPath);
    }
    if (mcpFiles.size === 0) return [];

    const exposures = findExposures(repo, mcpFiles);
    if (exposures.length === 0) return [];

    const controls = collectAuthControls(repo);
    const targets = mcpPaths(repo);
    const routeSites = mcpRouteSites(repo, targets);
    const effective = controls.filter(
      (c) => c.applies && covers(c.pathScope, targets) && runsBeforeMcpRoute(c, routeSites),
    );
    const shipsOff = controls.filter((c) => !c.applies);
    /** Credential-bearing, registered on the app — and still never reached by an MCP request. */
    const registeredLate = controls.filter(
      (c) => c.applies && covers(c.pathScope, targets) && !runsBeforeMcpRoute(c, routeSites),
    );

    if (effective.length > 0) return [];

    const findings: DetectorFinding[] = [];
    for (const ex of exposures) {
      const allIfaces = ex.host === "0.0.0.0";
      const severity: Severity = allIfaces ? "critical" : ex.host === "127.0.0.1" ? "medium" : "high";

      const late = registeredLate[0];
      const gap =
        shipsOff.length > 0
          ? `The only auth control in this repository (${shipsOff[0]?.symbol} in ${shipsOff[0]?.where}:${shipsOff[0]?.line}) does not apply as shipped: ${shipsOff[0]?.offReason}.`
          : late
            ? `The auth middleware ${late.symbol} is registered at ${late.where}:${late.line}, but the MCP route is registered earlier in the same file. A chain-ordered framework runs middleware in registration order, so the MCP route handler answers before the chain reaches the gate and ${late.symbol} never runs for it.`
            : controls.length > 0
              ? `Auth controls exist in this repository but none is applied to the MCP route${targets.length ? ` (${targets.join(", ")})` : ""}.`
              : `No authentication control is applied to this transport anywhere in the repository.`;

      const locations = [
        { path: ex.file.relPath, startLine: ex.line, endLine: ex.line, surface: "mcp_server" as Surface },
        ...ex.support.map((s) => ({
          path: ex.file.relPath,
          startLine: s.line,
          endLine: s.line,
          surface: "mcp_server" as Surface,
        })),
        ...[...shipsOff, ...registeredLate].slice(0, 1).map((c) => ({
          path: c.where,
          startLine: c.line,
          endLine: c.line,
          surface: "mcp_server" as Surface,
        })),
      ];

      findings.push({
        tier: "verified",
        classId: "unauth-mcp-transport",
        severity,
        surfaces: uniqueSurfaces(ex.file),
        locations,
        explanation:
          `The MCP transport is exposed over the network at ${ex.file.relPath}:${ex.line} (${ex.evidence}` +
          `${ex.host ? `, bound to ${ex.host}` : ""}). ${gap}` +
          `${allIfaces ? " The bind covers all interfaces, so anything that can route to the container can call every registered tool." : ""}`,
        reproduction: {
          kind: "inspection",
          steps: [
            `Open ${ex.file.relPath} at line ${ex.line} — ${ex.evidence}${ex.host ? ` binds ${ex.host}` : ""}.`,
            ...(shipsOff.length > 0
              ? [
                  `Open ${shipsOff[0]?.where} at line ${shipsOff[0]?.line}: the auth control is registered there, but ${shipsOff[0]?.offReason}.`,
                ]
              : late
                ? [
                    `Open ${late.where} at line ${late.line}: ${late.symbol} is registered there, below the MCP route registration, so the chain never reaches it for an MCP request.`,
                  ]
                : [
                    `Search the repository for an applied auth middleware, dependency or handler wrapper covering the MCP route — none is registered (commented-out and never-registered helpers do not count).`,
                  ]),
            `Connect to the transport without an Authorization header and issue tools/list.`,
          ],
          expected: `The MCP transport answers unauthenticated requests and exposes every registered tool.`,
        },
      });
    }
    return findings;
  },
};
