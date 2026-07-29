import type { Detector, DetectorFinding, ScanContext, ScanFile } from "@gatepass/engine";
import { lineAtIndex } from "@gatepass/engine";
import type { Severity, Surface } from "@gatepass/findings";

/**
 * Research-tier detector: hallucination-based vulnerability (HBV). A tool whose description is
 * VAGUE about scope while the capability it actually grants is BROAD or dangerous. The model has
 * nothing to reason with, so it fills the ambiguity with the most capable reading it can — and
 * the implementation obliges.
 *
 * Three axes have to be judged independently, because any one of them alone is a false positive:
 *
 *   - VAGUE is a property of the description text: length, generic verb + generic object
 *     ("performs a workspace operation", "handles things", "looks up information"), and the
 *     absence of scope-limiting language. Terse is not the same as vague-and-dangerous, which is
 *     why "Gets a user." on a pattern-constrained read-only lookup is clean here.
 *   - BROAD is a property of the capability, reached however the language reaches it: a raw SQL
 *     pool query, `subprocess`/`shell=True`/`execFile("/bin/sh")`, an outbound fetch whose URL is
 *     a caller-supplied argument with no literal base, destructive filesystem calls, or dispatch
 *     through a free-form string key into an operation registry that contains dangerous entries.
 *     Where there is no implementation to read (a bare tool manifest), the tool name is the only
 *     evidence of capability and is used as such.
 *   - CONSTRAINED is the escape hatch, and it dominates. If every parameter is pinned — a zod
 *     enum/regex, a JSON-Schema `enum`/`pattern`, a Python `Literal`, a Go `mcp.Enum`, or an
 *     explicit validation in the handler body — then the schema states the scope even when the
 *     prose does not, and the model cannot over-reach. A broad-sounding `run_command` narrowed
 *     to an allowlist is not an HBV.
 *
 * Fires only on vague AND broad AND unconstrained. Semantic, so research tier with a confidence
 * score (Principle II).
 */

/* ------------------------------------------------------------------ language + comments */

type Lang = "js" | "py" | "go" | "php" | "data" | "other";

const CODE_LANGS: ReadonlySet<Lang> = new Set<Lang>(["js", "py", "go", "php"]);

function langOf(relPath: string): Lang {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(relPath)) return "js";
  if (/\.py$/i.test(relPath)) return "py";
  if (/\.go$/i.test(relPath)) return "go";
  if (/\.php$/i.test(relPath)) return "php";
  if (/\.(json|ya?ml|toml)$/i.test(relPath)) return "data";
  return "other";
}

function blankComments(src: string, lang: Lang): string {
  if (!CODE_LANGS.has(lang)) return src;
  const out = src.split("");
  const n = src.length;
  const py = lang === "py";
  // `#` is a comment in Python and PHP; `//` and `/* */` in everything except Python.
  const hash = py || lang === "php";
  const slash = !py;
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
    if (slash && c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (slash && c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) if (out[k] !== "\n") out[k] = " ";
      i = stop;
      continue;
    }
    if (hash && c === "#") {
      while (i < n && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    i++;
  }
  return out.join("");
}

/** The innermost bracketed literal enclosing an offset — a PHP tool descriptor's own array. */
function enclosingBracket(src: string, offset: number): { inner: string; start: number; end: number } | null {
  const stack: number[] = [];
  let i = 0;
  while (i < offset && i < src.length) {
    const c = src[i] ?? "";
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "[" || c === "{" || c === "(") stack.push(i);
    else if (c === "]" || c === "}" || c === ")") stack.pop();
    i++;
  }
  const start = stack[stack.length - 1];
  if (start === undefined) return null;
  const bal = readBalanced(src, start);
  return bal ? { inner: bal.inner, start, end: bal.end } : null;
}

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

function splitTopLevel(inner: string, base = 0): { text: string; offset: number }[] {
  const parts: { text: string; offset: number }[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const push = (from: number, to: number) => {
    const raw = inner.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) parts.push({ text, offset: base + from + lead });
  };
  while (i < inner.length) {
    const c = inner[i] ?? "";
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(inner, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      push(start, i);
      start = i + 1;
    }
    i++;
  }
  push(start, inner.length);
  return parts;
}

function asStringLiteral(expr: string): string | null {
  const t = expr.trim();
  if (t.length < 2) return null;
  const q = t[0];
  if ((q !== '"' && q !== "'" && q !== "`") || t[t.length - 1] !== q) return null;
  return t.slice(1, -1);
}

/* ------------------------------------------------------------------ vagueness */

const GENERIC_OBJECT =
  /\b(thing|things|stuff|operation|operations|action|actions|task|tasks|request|requests|item|items|data|information|info|resource|resources|object|objects|entity|entities|record|records|content|command|commands|input|inputs|output|outputs|result|results|anything|something|everything|various|etc|misc|whatever)\b/i;

const GENERIC_VERB =
  /^\s*\W*(handles?|manages?|performs?|processes?|does|executes?|runs?|works?\s+with|deals?\s+with|interacts?\s+with|accesses?|uses?|looks?\s+up|helps?|allows?|enables?|provides?|supports?|gets?|returns?|fetch(?:es)?|retrieves?|reads?|lists?|calls?)\b/i;

const SPECIFIC =
  /\b(only|exactly|single|one|two|three|four|five|read-only|readonly|cannot|can\s?not|does not|never|must be|pre-written|prewritten|predefined|pre-defined|fixed|allowlist|whitelist|allow-list|specific|named|limited to|restricted to|no other|nothing else)\b/i;

/**
 * A parameter that *is* the operation: the caller writes what the tool does into it. When such a
 * parameter is free-form, no description can be specific about scope, because the scope is
 * whatever the caller sends — "Tidy up files in a project folder" with an `operation: string`
 * says nothing at all about what the tool may run.
 */
const DELEGATING_PARAM =
  /^(operation|operations|action|actions|command|commands|cmd|query|queries|sql|statement|script|code|expression|expr|task|op|ops|verb|method|instruction|instructions|request|args|argv|payload|do)$/i;

/** Does a parameter's own help text state which values are allowed? */
function boundsValues(desc: string): boolean {
  if (!desc.trim()) return false;
  if (SPECIFIC.test(desc)) return true;
  if (/\b(one of|either|must be|choose from|allowed values|valid values|e\.?g\.?)\b/i.test(desc)) return true;
  return (desc.match(/["'`][\w.: /-]+["'`]/g)?.length ?? 0) >= 2;
}

interface ToolParam {
  name: string;
  constrained: boolean;
  /** The parameter's own model-visible help text, when the schema carries one. */
  description?: string | undefined;
}

/**
 * Vagueness is a property of the whole model-visible contract, not of the description string
 * alone. The description is the main evidence, but a free-form parameter that carries the
 * operation itself is the contract *declining* to state a scope, and it counts as such.
 */
function vagueness(desc: string, params: ToolParam[] = []): { score: number; why: string[] } {
  const text = desc.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const why: string[] = [];
  let score = 0;

  const delegating = params.filter(
    (p) => !p.constrained && DELEGATING_PARAM.test(p.name) && !boundsValues(p.description ?? ""),
  );

  if (words === 0) {
    return { score: 4, why: ["it has no description at all"] };
  }
  if (words < 5) {
    score += 2;
    why.push(`it is ${words} words long`);
  } else if (words < 9) {
    score += 1;
  }
  if (GENERIC_OBJECT.test(text)) {
    score += 2;
    why.push("it names a placeholder object rather than what the tool acts on");
  }
  if (GENERIC_VERB.test(text)) {
    score += 1;
    why.push("it opens with a catch-all verb");
  }
  if (delegating.length > 0) {
    score += 2;
    why.push(
      `it leaves the actual operation to the caller — \`${delegating[0]?.name}\` is free-form text that neither the tool description nor the parameter's own help bounds`,
    );
  }
  if (SPECIFIC.test(text)) {
    score -= 2;
    why.push("(offset: it does state an explicit limit)");
  }
  return { score, why };
}

/* ------------------------------------------------------------------ capability */

const DANGEROUS_NAME =
  /\b(exec|execute|eval|shell|bash|cmd|command|run|spawn|system|sudo|admin|root|delete|destroy|drop|purge|remove|rm|write|upload|proxy|forward|curl|http|url|sql|raw|script|migrate|deploy|grant|impersonate|arbitrary|generic|any|all)\b/i;

const SINK_EXEC =
  /(child_process|execFile|execSync|spawnSync|\bspawn\s*\(|\/bin\/(?:sh|bash|zsh)|shell\s*:\s*true|shell\s*=\s*True|subprocess\.|os\.system|exec\.Command|\beval\s*\(|new\s+Function\s*\(|vm\.run|pty\.|\b(?:shell_exec|proc_open|passthru|popen|pcntl_exec)\s*\()/;

const SINK_FS_WRITE =
  /(fs\.(?:rm|rmdir|unlink|writeFile|rename|cp|copyFile|truncate)|rmSync|unlinkSync|writeFileSync|shutil\.(?:rmtree|move|copy)|os\.(?:remove|unlink|rmdir)|os\.(?:Remove|RemoveAll|WriteFile)|ioutil\.WriteFile|\.rm\s*\(|recursive\s*:\s*true)/;

/**
 * Member access is spelled `.` in most languages, `->` on a PHP instance and `::` on a PHP
 * static — the same raw-SQL sink either way, so all three spellings are matched.
 */
const SINK_SQL =
  /((?:\.|->|::)\s*(?:query|execute|exec|raw|unprepared|statement)\s*\(|cursor\.execute|sequelize\.query|db\.Query|db\.Exec|knex\.raw|\b(?:mysqli_query|pg_query|sqlite_query)\s*\()/;

/** The statement text is a fixed literal, so the caller is not writing SQL. */
const SQL_LITERAL_STATEMENT = /(?:\.|->|::)\s*(?:query|execute|exec|raw)\s*\(\s*["'`]/;

const SINK_HTTP =
  /(\bfetch\s*\(|axios\s*[.(]|requests\.(?:get|post|put|delete|patch|request)|httpx\.(?:get|post|put|delete|request|Client)|http\.NewRequest\w*|http\.(?:Get|Post|Head)|urllib\.request|client\.Do\s*\(|\.get\s*\(|\.post\s*\()/;

/** A base URL pinned in code means the caller cannot choose the destination host. */
const LITERAL_BASE =
  /(base_?url|baseURL|BASE_URL|BaseURL)\s*[:=]|["'`]https?:\/\/[^"'`$}]+["'`]|["'`]\/[a-z0-9._-]+\//i;

/** `REGISTRY[key]` / `getattr(obj, key)` — dispatch through a string the caller supplies. */
const SINK_DISPATCH = /(\[\s*[A-Za-z_$][\w$]*\s*\]|getattr\s*\(|globals\s*\(\s*\)\s*\[|\bswitch\s*\()/;

interface Repo {
  files: ScanFile[];
  code: Map<string, string>;
  lang: Map<string, Lang>;
  /** Symbol resolution is repo-wide and repeated; memoise it or a large repo pays O(ids x files). */
  defs: Map<string, { path: string; body: string; line: number } | null>;
}

const NOISE_IDENT = new Set([
  "const",
  "let",
  "var",
  "return",
  "async",
  "await",
  "function",
  "if",
  "else",
  "true",
  "false",
  "null",
  "undefined",
  "None",
  "text",
  "type",
  "content",
  "err",
  "error",
  "nil",
  "ctx",
  "context",
  "req",
  "res",
  "string",
  "number",
  "boolean",
]);

/**
 * Where a symbol *comes from*, when it is not defined in this repository.
 *
 * The dangerous capability usually is not written in the repo at all — it is imported. A handler
 * that calls `run(...)` reaches `const run = promisify(exec)`, and there the trail used to stop:
 * `exec` has no definition to find, so the fact that it is `node:child_process`'s `exec` was
 * lost and a shell-out read as an ordinary function call. Resolving a binding to its import
 * statement keeps the module name — which is the only statement of what the symbol can do.
 */
function importBinding(repo: Repo, escaped: string): { path: string; body: string; line: number } | null {
  const re = new RegExp(
    [
      `import\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}\\s*from\\s*["'][^"']+["']`,
      `import\\s+(?:\\*\\s*as\\s+)?${escaped}\\s+from\\s*["'][^"']+["']`,
      `(?:const|let|var)\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}\\s*=\\s*require\\s*\\([^)]*\\)`,
      `(?:const|let|var)\\s+${escaped}\\s*=\\s*require\\s*\\([^)]*\\)`,
      `from\\s+[\\w.]+\\s+import\\s+[^\\n]*\\b${escaped}\\b`,
      `import\\s+[\\w.]+\\s+as\\s+${escaped}\\b`,
    ].join("|"),
  );
  for (const f of repo.files) {
    const m = re.exec(repo.code.get(f.relPath) ?? "");
    if (!m) continue;
    return { path: f.relPath, body: m[0], line: lineAtIndex(f.content, m.index) };
  }
  return null;
}

function definitionSlice(repo: Repo, name: string): { path: string; body: string; line: number } | null {
  const cached = repo.defs.get(name);
  if (cached !== undefined) return cached;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?(?:public\\s+|private\\s+|protected\\s+|static\\s+)*(?:function|func|def)\\s+${escaped}\\b|(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\b\\s*[:=]`,
  );
  let found: { path: string; body: string; line: number } | null = null;
  for (const f of repo.files) {
    const src = repo.code.get(f.relPath) ?? "";
    const m = re.exec(src);
    if (!m) continue;
    const brace = src.indexOf("{", m.index);
    const bal = brace !== -1 && brace - m.index < 300 ? readBalanced(src, brace) : null;
    found = {
      path: f.relPath,
      body: bal ? src.slice(m.index, bal.end + 1) : src.slice(m.index, m.index + 1200),
      line: lineAtIndex(f.content, m.index),
    };
    break;
  }
  found ??= importBinding(repo, escaped);
  repo.defs.set(name, found);
  return found;
}

/** Identifiers explored per hop, and bodies pulled in overall — a bound, not a heuristic. */
const MAX_IDENTS_PER_HOP = 60;
const MAX_BODIES = 40;

/** Handler body plus the module-level symbols it reaches — one hop is enough for a registry. */
function reachableCode(repo: Repo, seed: string, depth = 2): { text: string; where: string[] } {
  let text = seed;
  const where: string[] = [];
  const seen = new Set<string>();
  let frontier = [seed];
  let bodies = 0;
  for (let d = 0; d < depth && bodies < MAX_BODIES; d++) {
    const next: string[] = [];
    for (const chunk of frontier) {
      for (const id of [...new Set(chunk.match(/[A-Za-z_$][\w$]*/g) ?? [])].slice(0, MAX_IDENTS_PER_HOP)) {
        if (NOISE_IDENT.has(id) || seen.has(id) || id.length < 2) continue;
        seen.add(id);
        const def = definitionSlice(repo, id);
        if (!def) continue;
        text += "\n" + def.body;
        where.push(`${def.path}:${def.line}`);
        next.push(def.body);
        if (++bodies >= MAX_BODIES) break;
      }
      if (bodies >= MAX_BODIES) break;
    }
    frontier = next;
  }
  return { text, where };
}

interface Capability {
  dangerous: boolean;
  signals: string[];
  exec: boolean;
  evidence: string[];
}

function capabilityOf(repo: Repo, toolName: string, params: string[], handler: string | null): Capability {
  const signals: string[] = [];
  const evidence: string[] = [];
  let exec = false;

  if (handler) {
    const { text, where } = reachableCode(repo, handler);
    const paramRe =
      params.length > 0
        ? new RegExp(
            `\\b(?:${params
              .map((p) => p.replace(/[^\w]/g, ""))
              .filter(Boolean)
              .join("|")})\\b`,
          )
        : null;

    if (SINK_EXEC.test(text)) {
      signals.push("it reaches a process-execution sink (a shell or subprocess call)");
      exec = true;
    }
    if (SINK_FS_WRITE.test(text))
      signals.push("it reaches destructive filesystem calls (write, rename or recursive delete)");
    if (SINK_SQL.test(text) && !SQL_LITERAL_STATEMENT.test(text))
      signals.push("it reaches a database query whose statement text is not a fixed literal");
    if (SINK_HTTP.test(text) && !LITERAL_BASE.test(text) && paramRe?.test(text))
      signals.push(
        "it issues an outbound request to a URL taken from a caller-supplied argument, with no pinned base URL",
      );
    if (SINK_DISPATCH.test(text) && (SINK_EXEC.test(text) || SINK_FS_WRITE.test(text)))
      signals.push(
        "the caller's string key selects an entry from an operation registry that contains dangerous operations",
      );
    evidence.push(...where.slice(0, 3));
  }

  // With no implementation in the tree, the tool name is the only statement of capability.
  if (signals.length === 0 && DANGEROUS_NAME.test(toolName.replace(/[_-]/g, " "))) {
    signals.push(`its name claims a broad capability ("${toolName}")`);
  }

  return { dangerous: signals.length > 0, signals, exec, evidence };
}

/* ------------------------------------------------------------------ constraints */

const CONSTRAINED_ZOD =
  /\.(enum|nativeEnum|literal|regex|uuid|cuid2?|ulid|email|url|datetime|date|time|ip|emoji|max|length|int|positive|nonnegative|gte|lte|step|finite|safe|pipe)\s*\(|\bz\.(number|boolean|bigint|date|literal|enum|nativeEnum|null|undefined|never|void)\b/;

const CONSTRAINED_JSON =
  /"(enum|const|pattern|maxLength|maximum|maxItems|format|oneOf|anyOf)"\s*:|"type"\s*:\s*"(number|integer|boolean)"/;

const CONSTRAINED_PY =
  /\bLiteral\s*\[|\bEnum\b|\b(int|float|bool|bytes|datetime|date|UUID)\b|pattern\s*=|max_length\s*=|\bconstr\s*\(|\ble\s*=|\blt\s*=|Annotated\s*\[/;

const CONSTRAINED_GO =
  /\b(?:mcp\.)?(Enum|Pattern|MaxLength|Max|Min|Items|DefaultString)\s*\(|WithNumber|WithBoolean|WithInt/;

/** An explicit guard in the handler body pins a parameter the schema left open. */
function bodyValidates(body: string, param: string): boolean {
  const p = param.replace(/[^\w]/g, "");
  if (!p) return false;
  const re = new RegExp(
    `(?:match|fullmatch|search|test|validate|assert|parse|startswith|startsWith|includes)\\s*\\(?[^\\n]{0,60}\\b${p}\\b|\\b${p}\\b[^\\n]{0,60}(?:not\\s+in\\b|\\bin\\s+[A-Z_]|\\.match\\b|\\.test\\b|instanceof|=== *["'])`,
  );
  return re.test(body);
}

/* ------------------------------------------------------------------ tool extraction */

interface ToolDef {
  name: string;
  description: string;
  path: string;
  line: number;
  params: ToolParam[];
  handler: string | null;
  surfaces: Surface[];
}

/** A parameter's own `description`, in whichever dialect the schema is written. */
function paramDescription(expr: string): string | undefined {
  const m =
    /\.describe\s*\(\s*(["'`])([\s\S]*?)\1/.exec(expr) ??
    /\bdescription\s*[:=]>?\s*(["'`])([\s\S]*?)\1/.exec(expr) ??
    /\b(?:mcp\.)?Description\s*\(\s*(["'`])([\s\S]*?)\1/.exec(expr);
  return m?.[2];
}

const TOOL_DEF_EVIDENCE =
  /(@modelcontextprotocol\/sdk|\bMcpServer\b|\bFastMCP\b|\bfastmcp\b|mcp\.server\b|mark3labs\/mcp-go|NewMCPServer\b|@mcp\.tool|@server\.tool|@app\.tool|\.registerTool\s*\(|mcp\.NewTool|\bAddTool\s*\(|\b\w+\.tool\s*\(|\badd_tool\s*\()/;

function isToolManifest(file: ScanFile): boolean {
  const base = file.relPath.slice(file.relPath.lastIndexOf("/") + 1).toLowerCase();
  if (/^(tools?|mcp|functions?|manifest)\.(json|ya?ml)$/.test(base) || base.endsWith(".mcp.json")) return true;
  return /"tools"\s*:\s*\[/.test(file.content);
}

interface RawTool {
  name?: unknown;
  description?: unknown;
  parameters?: Record<string, unknown>;
  inputSchema?: { properties?: Record<string, unknown>; required?: unknown };
}

function manifestTools(file: ScanFile): ToolDef[] {
  let parsed: { tools?: RawTool[] };
  try {
    parsed = JSON.parse(file.content) as { tools?: RawTool[] };
  } catch {
    return [];
  }
  const out: ToolDef[] = [];
  for (const tool of parsed.tools ?? []) {
    const name = typeof tool.name === "string" ? tool.name : "";
    const props = tool.inputSchema?.properties ?? tool.parameters ?? {};
    const params = Object.entries(props).map(([pname, schema]) => ({
      name: pname,
      constrained: CONSTRAINED_JSON.test(JSON.stringify(schema ?? {})),
      description:
        typeof (schema as { description?: unknown })?.description === "string"
          ? ((schema as { description?: string }).description ?? undefined)
          : undefined,
    }));
    const idx = name ? file.content.indexOf(`"${name}"`) : -1;
    out.push({
      name,
      description: typeof tool.description === "string" ? tool.description : "",
      path: file.relPath,
      line: idx >= 0 ? lineAtIndex(file.content, idx) : 1,
      params,
      handler: null,
      surfaces: [...new Set<Surface>([...file.surfaces, "tool_defs"])],
    });
  }
  return out;
}

function jsTools(file: ScanFile, src: string): ToolDef[] {
  const out: ToolDef[] = [];
  const callRe = /\.(tool|registerTool|addTool|defineTool)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(src)) !== null) {
    const open = src.indexOf("(", m.index);
    const bal = readBalanced(src, open);
    if (!bal) continue;
    const args = splitTopLevel(bal.inner, open + 1);
    const name = asStringLiteral(args[0]?.text ?? "") ?? "";
    if (!name) continue;

    let description = "";
    let schemaText = "";
    let handler: string | null = null;
    for (const a of args.slice(1)) {
      const lit = asStringLiteral(a.text);
      if (lit !== null && !description) {
        description = lit;
        continue;
      }
      if (/=>|\bfunction\b|\basync\b/.test(a.text)) {
        handler = a.text;
        continue;
      }
      if (a.text.startsWith("{")) {
        // `registerTool` config object carries description + inputSchema.
        const d = /\bdescription\s*:\s*(["'`])([\s\S]*?)\1/.exec(a.text);
        if (d && !description) description = d[2] ?? "";
        const inner = /\binputSchema\s*:\s*\{/.exec(a.text);
        if (inner) {
          const b2 = readBalanced(a.text, a.text.indexOf("{", inner.index + inner[0].length - 1));
          schemaText = b2?.inner ?? a.text;
        } else if (!schemaText) schemaText = a.text.slice(1, -1);
      }
    }

    const params = splitTopLevel(schemaText)
      .map((p): ToolParam | null => {
        const colon = p.text.indexOf(":");
        if (colon === -1) return null;
        const pname = p.text.slice(0, colon).trim().replace(/["']/g, "");
        if (!/^[\w$]+$/.test(pname)) return null;
        const expr = p.text.slice(colon + 1);
        return {
          name: pname,
          constrained:
            CONSTRAINED_ZOD.test(expr) ||
            CONSTRAINED_JSON.test(expr) ||
            (handler ? bodyValidates(handler, pname) : false),
          description: paramDescription(expr),
        };
      })
      .filter((p): p is ToolParam => p !== null);

    out.push({
      name,
      description,
      path: file.relPath,
      line: lineAtIndex(file.content, m.index),
      params,
      handler,
      surfaces: [...new Set<Surface>([...file.surfaces, "tool_defs"])],
    });
  }
  return out;
}

function pyTools(file: ScanFile, src: string): ToolDef[] {
  const out: ToolDef[] = [];
  const decoRe = /@[\w.]*\btool\b/g;
  let m: RegExpExecArray | null;
  while ((m = decoRe.exec(src)) !== null) {
    const defIdx = src.indexOf("def ", m.index);
    if (defIdx === -1 || defIdx - m.index > 400) continue;
    const nameMatch = /def\s+(\w+)\s*\(/.exec(src.slice(defIdx, defIdx + 200));
    const paren = src.indexOf("(", defIdx);
    const bal = paren === -1 ? null : readBalanced(src, paren);
    if (!bal || !nameMatch) continue;
    const colon = src.indexOf(":", bal.end);
    if (colon === -1) continue;

    // Body: everything until a line that is not indented (module level).
    const after = src.slice(colon + 1);
    const bodyEnd = /\n(?=\S)/.exec(after);
    const body = after.slice(0, bodyEnd ? bodyEnd.index : Math.min(after.length, 4000));
    const doc = /^\s*("""|''')([\s\S]*?)\1/.exec(body);

    const params = splitTopLevel(bal.inner)
      .map((p): ToolParam | null => {
        const pname = (p.text.split(/[:=]/)[0] ?? "").trim();
        if (!/^[\w]+$/.test(pname) || pname === "self" || pname === "cls") return null;
        const ann = p.text.slice(pname.length);
        return {
          name: pname,
          constrained: CONSTRAINED_PY.test(ann) || bodyValidates(body, pname),
          description: paramDescription(ann),
        };
      })
      .filter((p): p is ToolParam => p !== null);

    out.push({
      name: nameMatch[1] ?? "",
      description: (doc?.[2] ?? "").trim(),
      path: file.relPath,
      line: lineAtIndex(file.content, defIdx),
      params,
      handler: body,
      surfaces: [...new Set<Surface>([...file.surfaces, "tool_defs"])],
    });
  }
  return out;
}

function goTools(file: ScanFile, src: string): ToolDef[] {
  const out: ToolDef[] = [];
  const addRe = /\bAddTool\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = addRe.exec(src)) !== null) {
    const open = src.indexOf("(", m.index);
    const bal = readBalanced(src, open);
    if (!bal) continue;
    const args = splitTopLevel(bal.inner, open + 1);
    const toolExpr = args[0]?.text ?? "";
    const handlerRef = args[1]?.text ?? null;

    const nameLit = /NewTool\s*\(\s*(["'`])([^"'`]*)\1/.exec(toolExpr);
    const descLit = /WithDescription\s*\(\s*(["'`])([\s\S]*?)\1/.exec(toolExpr);

    const params: ToolParam[] = [];
    const withRe = /\bmcp\.With(String|Number|Boolean|Array|Object|Int)\s*\(/g;
    let w: RegExpExecArray | null;
    while ((w = withRe.exec(toolExpr)) !== null) {
      const o = toolExpr.indexOf("(", w.index);
      const b = readBalanced(toolExpr, o);
      if (!b) continue;
      const inner = b.inner;
      const pname = asStringLiteral(splitTopLevel(inner)[0]?.text ?? "") ?? "";
      if (!pname) continue;
      const typed = w[1] !== "String" && w[1] !== "Array" && w[1] !== "Object";
      params.push({
        name: pname,
        constrained: typed || CONSTRAINED_GO.test(inner),
        description: paramDescription(inner),
      });
    }

    out.push({
      name: nameLit?.[2] ?? "",
      description: descLit?.[2] ?? "",
      path: file.relPath,
      line: lineAtIndex(file.content, m.index),
      params,
      handler: handlerRef,
      surfaces: [...new Set<Surface>([...file.surfaces, "tool_defs"])],
    });
  }
  return out;
}

/* ---- PHP ---- */

/**
 * PHP declares MCP tools as an associative array rather than a builder call, so the descriptor
 * is found by its keys — a `name` sitting in the same array literal as a `description` and
 * either a schema or a handler. Same three axes as everywhere else; only the syntax differs.
 */
const PHP_TOOL_EVIDENCE = /(['"])(?:inputSchema|input_schema|parameters)\1\s*=>/;

const PHP_CONSTRAINED = /(['"])(?:enum|const|pattern|maxLength|maximum|maxItems|format|oneOf|anyOf)\1\s*=>/;
const PHP_TYPED = /(['"])type\1\s*=>\s*(['"])(?:number|integer|boolean)\2/;

function phpArrayAfterKey(body: string, key: RegExp): string | null {
  const m = key.exec(body);
  if (!m) return null;
  const open = body.indexOf("[", m.index + m[0].length - 1);
  if (open === -1) return null;
  return readBalanced(body, open)?.inner ?? null;
}

function phpTools(file: ScanFile, src: string): ToolDef[] {
  const out: ToolDef[] = [];
  const nameRe = /(['"])name\1\s*=>\s*(['"])([^'"]*)\2/g;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(src)) !== null) {
    const region = enclosingBracket(src, m.index);
    if (!region) continue;
    const body = region.inner;
    const desc = /(['"])description\1\s*=>\s*(['"])((?:[^'"\\]|\\.)*)\2/.exec(body);
    if (!desc) continue;

    const schema = phpArrayAfterKey(body, /(['"])(?:inputSchema|input_schema|parameters)\1\s*=>\s*\[/) ?? null;
    const propsText = schema === null ? null : (phpArrayAfterKey(schema, /(['"])properties\1\s*=>\s*\[/) ?? schema);

    // `'handler' => function (...) {...}` or `'handler' => 'some_function'`.
    let handler: string | null = null;
    const h = /(['"])(?:handler|callback|handle|invoke|fn)\1\s*=>\s*/.exec(body);
    if (h) {
      const rest = body.slice(h.index + h[0].length);
      const brace = /^\s*(?:static\s+)?(?:function|fn)\b/.test(rest) ? rest.indexOf("{") : -1;
      const bal = brace !== -1 ? readBalanced(rest, brace) : null;
      handler = bal ? bal.inner : (asStringLiteral(splitTopLevel(rest)[0]?.text ?? "") ?? null);
    }

    const params: ToolParam[] = [];
    for (const entry of propsText === null ? [] : splitTopLevel(propsText)) {
      const p = /^(['"])(\w+)\1\s*=>\s*([\s\S]*)$/.exec(entry.text);
      if (!p) continue;
      const spec = p[3] ?? "";
      params.push({
        name: p[2] ?? "",
        constrained:
          PHP_CONSTRAINED.test(spec) || PHP_TYPED.test(spec) || (handler ? bodyValidates(handler, p[2] ?? "") : false),
        description: paramDescription(spec),
      });
    }

    out.push({
      name: m[3] ?? "",
      description: desc[3] ?? "",
      path: file.relPath,
      line: lineAtIndex(file.content, m.index),
      params,
      handler,
      surfaces: [...new Set<Surface>([...file.surfaces, "tool_defs"])],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ detector */

export const hbvDetector: Detector = {
  classIds: ["hbv"],
  tier: "research",
  run(ctx: ScanContext): DetectorFinding[] {
    const repo: Repo = { files: ctx.files, code: new Map(), lang: new Map(), defs: new Map() };
    for (const f of ctx.files) {
      const l = langOf(f.relPath);
      repo.lang.set(f.relPath, l);
      repo.code.set(f.relPath, blankComments(f.content, l));
    }

    const tools: ToolDef[] = [];
    for (const f of ctx.files) {
      const lang = repo.lang.get(f.relPath) ?? "other";
      const src = repo.code.get(f.relPath) ?? "";
      if (lang === "data") {
        if (isToolManifest(f)) tools.push(...manifestTools(f));
        continue;
      }
      if (lang === "other") continue;
      if (lang === "php") {
        if (PHP_TOOL_EVIDENCE.test(src)) tools.push(...phpTools(f, src));
        continue;
      }
      if (!TOOL_DEF_EVIDENCE.test(src)) continue;
      if (lang === "js") tools.push(...jsTools(f, src));
      else if (lang === "py") tools.push(...pyTools(f, src));
      else tools.push(...goTools(f, src));
    }

    const findings: DetectorFinding[] = [];
    const seen = new Set<string>();

    for (const tool of tools) {
      const vague = vagueness(tool.description, tool.params);
      if (vague.score < 3) continue;

      const paramNames = tool.params.map((p) => p.name);
      const cap = capabilityOf(repo, tool.name, paramNames, tool.handler);
      if (!cap.dangerous) continue;

      const open = tool.params.filter((p) => !p.constrained);
      // The schema states the scope even when the prose does not.
      if (tool.params.length > 0 && open.length === 0) continue;

      const key = `${tool.path}:${tool.line}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let confidence = 0.5 + cap.signals.length * 0.1 + (open.length > 0 ? 0.1 : 0);
      if (vague.score >= 5) confidence += 0.05;
      confidence = Math.min(0.9, Number(confidence.toFixed(3)));
      const severity: Severity = cap.exec ? "critical" : "high";

      const openList = open.length > 0 ? open.map((p) => `\`${p.name}\``).join(", ") : "none declared";

      findings.push({
        tier: "research",
        classId: "hbv",
        severity,
        surfaces: tool.surfaces,
        locations: [{ path: tool.path, startLine: tool.line, endLine: tool.line, surface: "tool_defs" }],
        explanation:
          `Tool "${tool.name}" at ${tool.path}:${tool.line} is vague about its scope while granting a broad capability. ` +
          `The description is under-specified — ${vague.why.filter((w) => !w.startsWith("(")).join(", ")}. ` +
          `The capability behind it is broad: ${cap.signals.join("; ")}` +
          `${cap.evidence.length > 0 ? ` (reached via ${cap.evidence.join(", ")})` : ""}. ` +
          `Nothing in the schema narrows it: ${openList === "none declared" ? "no parameters are declared at all" : `${openList} accept${open.length === 1 ? "s" : ""} free-form values`}. ` +
          `The model must guess the intended scope and tends to resolve the ambiguity toward the most capable reading — ` +
          `a hallucination-based vulnerability. State what the tool may and may not do, and constrain the parameters ` +
          `to an enum, pattern or allowlist.`,
        confidence,
      });
    }

    return findings;
  },
};
