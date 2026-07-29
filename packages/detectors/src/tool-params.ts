import type { Detector, DetectorFinding, ScanContext, ScanFile } from "@gatepass/engine";
import { lineAtIndex } from "@gatepass/engine";
import type { Surface } from "@gatepass/findings";

/**
 * Verified detectors over the tool-definition / handler-input surface.
 *
 *  - `unbounded-tool-param`: ONE parameter whose declared schema places no upper bound on the
 *    value space — no enum/const, pattern, maxLength, maximum, maxItems or the dialect
 *    equivalent. The judgement is per parameter, never per schema: a schema that bounds a
 *    cosmetic field and leaves the dangerous one bare is still unbounded on that field. It is
 *    also made only after following indirection, because a constraint is no less real for
 *    living somewhere else — a `$ref` into `$defs`, a shared zod helper in another module and
 *    a pydantic `Annotated[...]` alias in another module all carry their bounds with them.
 *    Where indirection cannot be resolved we assume the target is constrained: a missed
 *    finding costs less than a false one.
 *
 *  - `missing-schema-validation`: model- or client-controlled input reaches an effectful
 *    operation with no runtime shape check applied to it anywhere on the way. Two shapes are
 *    easy to mistake for safety and are not: a schema that is declared, exported and even
 *    advertised to the client but never actually applied to the incoming value, and a Python
 *    `TypedDict` (or `dict[str, Any]`) annotation, which is erased at runtime and checks
 *    nothing. Conversely, validation performed by a framework — tRPC `.input()`, a FastAPI
 *    pydantic body model, the MCP SDK's `inputSchema` — or by route middleware defined in
 *    another file IS validation, and is not reported.
 *
 * Both detectors are deterministic functions of the scan context.
 */

/* ------------------------------------------------------------------ generic text scanning */

type JsonObj = Record<string, unknown>;

function isObj(v: unknown): v is JsonObj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const JS_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i;
const PY_EXT = /\.py$/i;
const CS_EXT = /\.cs$/i;
const RB_EXT = /\.rb$/i;
const PROTO_EXT = /\.proto$/i;
const STRUCTURED_EXT = /\.(?:json|ya?ml)$/i;
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|spec|fixtures?|examples?)(?:\/|$)|\.(?:test|spec)\.[jt]sx?$|_test\.py$/i;

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/**
 * Index of the bracket closing the one at `openIdx`, skipping string literals and comments.
 * Returns -1 when the source is unbalanced (truncated or minified past recognition), which
 * every caller treats as "cannot analyse" rather than "no constraint".
 */
function balancedEnd(content: string, openIdx: number): number {
  const open = content[openIdx];
  if (!open || !(open in OPENERS)) return -1;
  let depth = 0;
  let quote = "";
  for (let i = openIdx; i < content.length; i++) {
    const c = content[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === "/" && content[i + 1] === "/") {
      const nl = content.indexOf("\n", i);
      if (nl < 0) return -1;
      i = nl;
      continue;
    }
    if (c === "/" && content[i + 1] === "*") {
      const e = content.indexOf("*/", i);
      if (e < 0) return -1;
      i = e + 1;
      continue;
    }
    if (c in OPENERS) depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/** Split on `sep` at bracket depth 0, ignoring separators inside strings. */
function splitTopLevel(text: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c in OPENERS) depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Arguments of the call whose `(` is at `openIdx`, as raw source text. */
function callArgs(content: string, openIdx: number): { args: string[]; end: number } | undefined {
  const end = balancedEnd(content, openIdx);
  if (end < 0) return undefined;
  return { args: splitTopLevel(content.slice(openIdx + 1, end)), end };
}

/**
 * Replace the *contents* of every parenthesised group with nothing, keeping the call names.
 * `z.array(z.string().uuid()).min(1).max(50)` becomes `z.array().min().max()`, which is what
 * lets us tell a bound on the container from a bound on its items — the array above is capped
 * at 50 entries, whereas `z.array(z.string().max(10))` caps only each element and leaves the
 * list itself unbounded.
 */
function outerChain(expr: string): string {
  let out = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (depth === 0 && (c === "'" || c === '"' || c === "`")) {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[") {
      depth++;
      if (depth === 1) out += c;
      continue;
    }
    if (c === ")" || c === "]") {
      depth--;
      if (depth === 0) out += c;
      continue;
    }
    if (depth === 0) out += c;
  }
  return out;
}

/* -------------------------------------------------------------- surface / scope decisions */

/** A file that plausibly *declares tool input schemas* (as opposed to any file using zod). */
const TOOL_PATH = /(?:^|\/)(?:tools?|mcp|agents?|functions?|skills?)(?:\/|[._-]|$)/i;
const TOOL_REGISTRATION =
  /\b(?:server|mcp|app|agent|registry|client)\s*\.\s*(?:tool|registerTool|addTool|register_tool|add_tool)\s*\(|@\w*(?:mcp|server|app|tool)\w*\.tool\b|\b(?:inputSchema|input_schema)\s*[:=]|\btools\s*[:=]\s*\[|\[\s*(?:KernelFunction|SKFunction|McpServerTool|AIFunction)\b|\brpc\s+\w+\s*\(/;

function isToolSchemaSurface(file: ScanFile): boolean {
  if (TEST_PATH.test(file.relPath)) return false;
  if (file.surfaces.includes("tool_defs") || file.surfaces.includes("mcp_server")) return true;
  if (TOOL_PATH.test(file.relPath)) return true;
  // An OpenAPI document whose operations are marked as agent tools declares tool inputs just
  // as much as a `tools.json` does, and it is almost never under a `tools/` path.
  if (isOpenApiAgentDoc(file)) return true;
  return TOOL_REGISTRATION.test(file.content);
}

/** A file that plausibly *handles* inbound requests or tool calls. */
const HANDLER_PATH =
  /(?:^|\/)(?:tools?|mcp|agents?|handlers?|routes?|routers?|controllers?|api|server|endpoints?|functions?|views?|registry)(?:\/|[._-]|$)/i;
const HANDLER_MARKER =
  /\b(?:inputSchema|input_schema)\s*[:=]|\.\s*(?:tool|registerTool|addTool|setRequestHandler)\s*\(|\b\w+\s*\.\s*(?:get|post|put|patch|delete|use)\s*\(\s*["'`/]|@\s*\w+\s*\.\s*(?:get|post|put|patch|delete|route|tool)\b|\bhandler\s*[:(]/;

/** Sinatra/Grape route blocks: a bare verb, a path literal and `do` — no receiver, no parens. */
const RUBY_ROUTE_MARKER = /^[ \t]*(?:get|post|put|patch|delete|options)\s+['"][^'"]*['"]\s+do\b/m;

function isHandlerSurface(file: ScanFile): boolean {
  if (TEST_PATH.test(file.relPath)) return false;
  if (file.surfaces.includes("tool_defs") || file.surfaces.includes("mcp_server")) return true;
  if (HANDLER_PATH.test(file.relPath)) return true;
  if (RB_EXT.test(file.relPath) && RUBY_ROUTE_MARKER.test(file.content)) return true;
  return HANDLER_MARKER.test(file.content);
}

function surfaceOf(file: ScanFile): Surface {
  if (file.surfaces.includes("tool_defs")) return "tool_defs";
  return file.surfaces[0] ?? "app_code";
}

/* ------------------------------------------------------------- structured tool manifests */

function topLevelColon(text: string): number {
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c in OPENERS) depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ":" && depth === 0 && (i + 1 >= text.length || /\s/.test(text[i + 1]!))) return i;
  }
  return -1;
}

/**
 * A deliberately small YAML reader: enough of the language to read a tool manifest written in
 * YAML rather than JSON (block maps, block sequences, flow scalars). Anything it cannot make
 * sense of yields a structure the caller does not recognise as tool definitions, so a parse
 * failure degrades to "no findings" instead of to guesses.
 */
function parseMiniYaml(src: string): unknown {
  interface L {
    indent: number;
    text: string;
  }
  const lines: L[] = [];
  for (const raw of src.split(/\r?\n/)) {
    const noComment = raw.replace(/(^|\s)#.*$/, "$1");
    if (!noComment.trim()) continue;
    if (/^\s*(?:---|\.\.\.)\s*$/.test(noComment)) continue;
    lines.push({ indent: noComment.length - noComment.trimStart().length, text: noComment.trim() });
  }
  let i = 0;

  const scalar = (t: string): unknown => {
    if (t === "" || t === "~" || t === "null") return null;
    if (t === "true" || t === "True") return true;
    if (t === "false" || t === "False") return false;
    if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
    if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
      return t.slice(1, -1);
    }
    if (t.startsWith("[") && t.endsWith("]")) {
      const inner = t.slice(1, -1).trim();
      return inner ? splitTopLevel(inner).map(scalar) : [];
    }
    if (t.startsWith("{") && t.endsWith("}")) {
      const inner = t.slice(1, -1).trim();
      const o: JsonObj = {};
      if (inner) {
        for (const part of splitTopLevel(inner)) {
          const k = topLevelColon(part);
          if (k > 0) o[String(scalar(part.slice(0, k).trim()))] = scalar(part.slice(k + 1).trim());
        }
      }
      return o;
    }
    return t;
  };

  const unquote = (k: string) => k.replace(/^["']|["']$/g, "");

  const parseMap = (indent: number): JsonObj => {
    const obj: JsonObj = {};
    while (i < lines.length && lines[i]!.indent === indent && !lines[i]!.text.startsWith("- ")) {
      const line = lines[i]!;
      const c = topLevelColon(line.text);
      if (c < 0) {
        i++;
        continue;
      }
      const key = unquote(line.text.slice(0, c).trim());
      const val = line.text.slice(c + 1).trim();
      i++;
      if (val) obj[key] = scalar(val);
      else if (i < lines.length && lines[i]!.indent > indent) obj[key] = parseNode(lines[i]!.indent);
      else if (i < lines.length && lines[i]!.indent === indent && lines[i]!.text.startsWith("- ")) {
        obj[key] = parseNode(indent);
      } else obj[key] = null;
    }
    return obj;
  };

  const parseSeq = (indent: number): unknown[] => {
    const arr: unknown[] = [];
    while (i < lines.length && lines[i]!.indent === indent && lines[i]!.text.startsWith("- ")) {
      const rest = lines[i]!.text.slice(2).trim();
      const c = topLevelColon(rest);
      if (c < 0) {
        i++;
        arr.push(scalar(rest));
        continue;
      }
      // A mapping whose first key sits on the dash line; subsequent keys are indented past it.
      const itemIndent = indent + 2;
      const obj: JsonObj = {};
      const key = unquote(rest.slice(0, c).trim());
      const val = rest.slice(c + 1).trim();
      i++;
      if (val) obj[key] = scalar(val);
      else if (i < lines.length && lines[i]!.indent > itemIndent) obj[key] = parseNode(lines[i]!.indent);
      else obj[key] = null;
      while (i < lines.length && lines[i]!.indent >= itemIndent && !lines[i]!.text.startsWith("- ")) {
        Object.assign(obj, parseMap(lines[i]!.indent));
        if (i < lines.length && lines[i]!.indent > itemIndent) i++;
        else break;
      }
      arr.push(obj);
    }
    return arr;
  };

  const parseNode = (indent: number): unknown => {
    if (i >= lines.length) return null;
    return lines[i]!.text.startsWith("- ") ? parseSeq(indent) : parseMap(indent);
  };

  return lines.length ? parseNode(lines[0]!.indent) : null;
}

interface ToolDef {
  name?: string;
  /** The raw schema container as written (`parameters`, `inputSchema`, …), or undefined. */
  container?: JsonObj;
  properties: JsonObj;
}

/** The schema container of a tool, whichever of the competing spellings it uses. */
function schemaContainer(tool: JsonObj): JsonObj | undefined {
  for (const key of ["inputSchema", "input_schema", "parameters", "schema", "arguments", "args"]) {
    const v = tool[key];
    if (isObj(v)) return v;
  }
  return undefined;
}

function containerProperties(container: JsonObj | undefined): JsonObj {
  if (!container) return {};
  const props = container["properties"];
  if (isObj(props)) return props;
  // Not a JSON Schema envelope: the legacy shape where `parameters` IS the property map.
  if (container["type"] !== undefined || container["$ref"] !== undefined) return {};
  const direct: JsonObj = {};
  for (const [k, v] of Object.entries(container)) if (isObj(v)) direct[k] = v;
  return direct;
}

/** Pull tool definitions out of a parsed manifest, whatever container the author used. */
function toolDefsOf(root: unknown): ToolDef[] {
  const lists: unknown[] = [];
  if (Array.isArray(root)) lists.push(root);
  if (isObj(root)) {
    for (const key of ["tools", "functions", "toolDefinitions", "tool_definitions", "capabilities"]) {
      const v = root[key];
      if (Array.isArray(v)) lists.push(v);
      else if (isObj(v)) lists.push(Object.entries(v).map(([name, def]) => (isObj(def) ? { name, ...def } : { name })));
    }
  }
  const defs: ToolDef[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!isObj(entry)) continue;
      // OpenAI wraps each entry as { type: "function", function: { name, parameters } }.
      const tool = isObj(entry["function"]) ? (entry["function"] as JsonObj) : entry;
      if (typeof tool["name"] !== "string") continue;
      const container = schemaContainer(tool);
      defs.push({ name: tool["name"], container, properties: containerProperties(container) });
    }
  }
  return defs;
}

/* --------------------------------------------------------------- OpenAPI agent operations */

/**
 * An OpenAPI operation is a tool definition when something marks it as one for a model to
 * call — GPT Actions' `x-openai-isConsequential`, an `x-agent-tool`, an `x-mcp-*` extension.
 * The marker is required: a plain REST spec describes an API for programmers, and treating
 * every operation in one as an agent tool would report most of the internet.
 */
const OPENAPI_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const AGENT_MARKER_WORD =
  /^(?:ai|llm|gpt|mcp|tool|tools|agent|agents|openai|anthropic|claude|function|functions|plugin|skill|assistant|copilot)$/i;
/** Cheap text pre-check so a non-agent spec is never parsed. Mirrors `isAgentToolExtension`. */
const AGENT_EXTENSION_TEXT =
  /(?:^|[\s{,])["']?x-(?:[\w.]*[-_])?(?:ai|llm|gpt|mcp|tools?|agents?|openai|anthropic|claude|functions?|plugin|skill|assistant|copilot)(?:[-_][\w.-]*)?["']?\s*:/i;
const OPENAPI_DOC = /(?:^|\n)\s*["']?(?:openapi|swagger)["']?\s*:/;

function isAgentToolExtension(key: string): boolean {
  if (!/^x-/i.test(key)) return false;
  return key
    .slice(2)
    .split(/[-_.]/)
    .some((word) => AGENT_MARKER_WORD.test(word));
}

function isOpenApiAgentDoc(file: ScanFile): boolean {
  return STRUCTURED_EXT.test(file.relPath) && OPENAPI_DOC.test(file.content) && AGENT_EXTENSION_TEXT.test(file.content);
}

/**
 * Tool definitions from the marked operations of an OpenAPI document. Both parameter schemas
 * and the request body's properties are inputs the model chooses, so both are parameters.
 */
function openApiToolDefs(root: unknown): ToolDef[] {
  if (!isObj(root) || (root["openapi"] === undefined && root["swagger"] === undefined)) return [];
  const paths = root["paths"];
  if (!isObj(paths)) return [];
  const info = isObj(root["info"]) ? (root["info"] as JsonObj) : {};
  const docMarked = Object.keys(root).some(isAgentToolExtension) || Object.keys(info).some(isAgentToolExtension);

  const defs: ToolDef[] = [];
  for (const [route, item] of Object.entries(paths)) {
    if (!isObj(item)) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!OPENAPI_METHODS.has(method.toLowerCase()) || !isObj(operation)) continue;
      if (!docMarked && !Object.keys(operation).some(isAgentToolExtension)) continue;

      const properties: JsonObj = {};
      const params = operation["parameters"];
      if (Array.isArray(params)) {
        for (const p of params) {
          if (!isObj(p) || typeof p["name"] !== "string") continue;
          properties[p["name"]] = isObj(p["schema"]) ? (p["schema"] as JsonObj) : p;
        }
      }
      const body = operation["requestBody"];
      if (isObj(body) && isObj(body["content"])) {
        for (const media of Object.values(body["content"] as JsonObj)) {
          if (!isObj(media) || !isObj(media["schema"])) continue;
          const schema = media["schema"] as JsonObj;
          const props = schema["properties"];
          if (isObj(props)) for (const [k, v] of Object.entries(props)) properties[k] = v;
          else properties["body"] = schema;
          break;
        }
      }
      if (Object.keys(properties).length === 0) continue;

      const name = typeof operation["operationId"] === "string" ? operation["operationId"] : `${method} ${route}`;
      defs.push({ name, container: operation, properties });
    }
  }
  return defs;
}

/* ---------------------------------------------------------------- JSON Schema boundedness */

/** Formats that pin a value to a short, syntactically rigid shape. `email`, `uri` and
 *  `hostname` are deliberately absent — they constrain the grammar, not the length. */
const BOUNDED_FORMATS = new Set(["uuid", "guid", "date", "time", "date-time", "duration", "ipv4", "ipv6"]);

const BOUND_KEYWORDS = [
  "enum",
  "const",
  "maxLength",
  "pattern",
  "maximum",
  "exclusiveMaximum",
  "maxItems",
  "maxProperties",
  "$ref",
  "allOf",
  "anyOf",
  "oneOf",
];

function resolvePointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#")) return undefined;
  const path = ref.slice(1).replace(/^\//, "");
  if (!path) return root;
  let node: unknown = root;
  for (const rawPart of path.split("/")) {
    const part = decodeURIComponent(rawPart).replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(node)) node = node[Number(part)];
    else if (isObj(node)) node = node[part];
    else return undefined;
    if (node === undefined) return undefined;
  }
  return node;
}

function typeNames(t: unknown): string[] {
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

interface RefCtx {
  root: unknown;
  depth: number;
  refs: Set<string>;
}

/**
 * One leaf that accepts unbounded input.
 *
 * `bulk` distinguishes the two ways a value space can be open, because they are consequential
 * for different reasons. An unbounded *value* (a bare string, an uncapped integer) matters when
 * something interprets it. An unbounded *volume* — an array with no `maxItems`, a free-form
 * object, `additionalProperties: true` — matters whatever the values mean, because the caller
 * alone decides how much arrives.
 */
interface JsonLeaf {
  path: string;
  bulk: boolean;
}

/**
 * Every leaf under `schema` that accepts unbounded input. Empty means the whole subtree is
 * bounded.
 */
function jsonUnboundedPaths(schema: unknown, path: string, c: RefCtx): JsonLeaf[] {
  if (c.depth > 8) return [];
  if (schema === false) return [];
  if (schema === true) return [{ path, bulk: true }];
  if (!isObj(schema)) return [];

  const ref = schema["$ref"];
  if (typeof ref === "string") {
    if (c.refs.has(ref)) return []; // cycle — assume the definition constrains itself
    const target = resolvePointer(c.root, ref);
    if (target === undefined) return []; // external/unresolvable — assume constrained
    return jsonUnboundedPaths(target, path, {
      root: c.root,
      depth: c.depth + 1,
      refs: new Set(c.refs).add(ref),
    });
  }

  if (schema["enum"] !== undefined || schema["const"] !== undefined) return [];

  const sub: RefCtx = { root: c.root, depth: c.depth + 1, refs: c.refs };
  const allOf = schema["allOf"];
  if (Array.isArray(allOf) && allOf.length > 0) {
    // Every branch applies at once, so one bounding branch bounds the whole.
    return allOf.some((s) => jsonUnboundedPaths(s, path, sub).length === 0) ? [] : [{ path, bulk: false }];
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = schema[key];
    if (Array.isArray(branches) && branches.length > 0) {
      // Any branch may be chosen, so all of them must bound.
      return branches.every((s) => jsonUnboundedPaths(s, path, sub).length === 0) ? [] : [{ path, bulk: false }];
    }
  }

  const types = typeNames(schema["type"]);
  if (types.length === 0) {
    return BOUND_KEYWORDS.some((k) => schema[k] !== undefined) ? [] : [{ path, bulk: false }];
  }

  const out = new Map<string, JsonLeaf>();
  const add = (leaf: JsonLeaf): void => {
    const prev = out.get(leaf.path);
    out.set(leaf.path, prev ? { path: leaf.path, bulk: prev.bulk || leaf.bulk } : leaf);
  };
  for (const t of types) {
    switch (t) {
      case "boolean":
      case "null":
        break;
      case "string": {
        const format = schema["format"];
        if (schema["maxLength"] !== undefined || schema["pattern"] !== undefined) break;
        if (typeof format === "string" && BOUNDED_FORMATS.has(format)) break;
        add({ path, bulk: false });
        break;
      }
      case "number":
      case "integer":
        if (schema["maximum"] === undefined && schema["exclusiveMaximum"] === undefined) {
          add({ path, bulk: false });
        }
        break;
      case "array":
        if (schema["maxItems"] === undefined) add({ path, bulk: true });
        break;
      case "object": {
        if (schema["maxProperties"] !== undefined) break;
        const props = schema["properties"];
        const addl = schema["additionalProperties"];
        if (isObj(props) && Object.keys(props).length > 0) {
          // A declared shape is a bound in itself; recurse so the report names the bare leaf.
          if (addl === true) add({ path, bulk: true });
          for (const [k, v] of Object.entries(props)) {
            for (const leaf of jsonUnboundedPaths(v, `${path}.${k}`, sub)) add(leaf);
          }
          break;
        }
        if (addl !== false) add({ path, bulk: true }); // free-form bag: any key, value and size
        break;
      }
      default:
        break;
    }
  }
  return [...out.values()];
}

/* ------------------------------------------------------- is an open bound consequential? */

/**
 * Two tool manifests can be byte-for-byte the same shape and mean opposite things:
 *
 *   { "name": "run_query",   "parameters": { "sql":  { "type": "string" } } }
 *   { "name": "get_weather", "parameters": { "city": { "type": "string" } } }
 *
 * Both declare one bare string. Only the first is a finding, and no amount of schema analysis
 * can tell them apart, because the schemas are identical — the difference is what the value
 * becomes. Reporting on shape alone means reporting every string parameter in every manifest
 * ever written, which is not a precision problem to be tuned down later; it is the wrong
 * question. So an unbounded parameter is reported only when the open value space is
 * consequential, on one of three independent grounds:
 *
 *   1. SIBLING EVIDENCE — some other parameter of the same tool carries an explicit bound. The
 *      author knew how to bound a parameter and bounded the others; the bare one is the gap,
 *      not the house style. This is the single strongest signal in the class, and it is exactly
 *      the shape that reads as safe on a skim: the diligent siblings are misdirection.
 *   2. BULK — the parameter admits unbounded *volume* (an array with no `maxItems`, a free-form
 *      object, `additionalProperties: true`). How much arrives is the caller's choice whatever
 *      the values mean, so the semantics do not need arguing.
 *   3. INTERPRETED ROLE — the value is acted on rather than merely matched: a command line, a
 *      query, a path, an address, a template, raw content. Either the parameter's name says so
 *      (`sql`, `command`, `migrationArgs`, `destination`), or the value is seen reaching an
 *      exec / query / filesystem sink in the scanned code.
 *
 * A plain domain noun — a city, a currency, a status — is a value the tool looks up. Leaving it
 * unbounded is untidy, not a vulnerability, and calling it one costs the class its credibility.
 */

/** Identifier split into lowercase words, so `migrationArgs` and `merge_vars` both tokenise. */
function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

/**
 * Roles whose value the receiving system *interprets* — as a program, a query, a location or a
 * document — rather than compares. This is a vocabulary of roles, not of fixtures: it is the
 * same list one would write for any tool surface, and it deliberately excludes ordinary domain
 * nouns, which is the whole point of having it.
 */
const INTERPRETED_ROLE = new Set([
  // executed
  "cmd",
  "cmds",
  "command",
  "commands",
  "shell",
  "script",
  "scripts",
  "exec",
  "entrypoint",
  "argv",
  "arg",
  "args",
  "argument",
  "arguments",
  "flag",
  "flags",
  "option",
  "options",
  "code",
  "eval",
  "snippet",
  "expression",
  "expr",
  "formula",
  "predicate",
  "condition",
  // queried
  "sql",
  "query",
  "queries",
  "statement",
  "clause",
  "where",
  "filter",
  "filters",
  "selector",
  "xpath",
  "jsonpath",
  "jq",
  "cypher",
  "graphql",
  "aggregation",
  "pipeline",
  // matched as a program in its own right
  "pattern",
  "patterns",
  "glob",
  "regex",
  "regexp",
  "template",
  "format",
  // located
  "path",
  "paths",
  "file",
  "files",
  "filename",
  "filepath",
  "dir",
  "dirs",
  "directory",
  "directories",
  "folder",
  "cwd",
  "workdir",
  "destination",
  "dest",
  "target",
  "source",
  "src",
  "location",
  "prefix",
  "bucket",
  "table",
  "collection",
  "namespace",
  // addressed
  "url",
  "uri",
  "endpoint",
  "host",
  "hostname",
  "domain",
  "address",
  "origin",
  "callback",
  "webhook",
  "redirect",
  "proxy",
  // carried through verbatim
  "body",
  "content",
  "contents",
  "payload",
  "blob",
  "raw",
  "document",
  "html",
  "markup",
  "prompt",
  "instruction",
  "instructions",
]);

function hasInterpretedRole(paramPath: string): boolean {
  // Judge every segment: `filters.column` is interpreted through `filters` as much as its leaf.
  return paramPath.split(".").some((seg) => nameWords(seg).some((w) => INTERPRETED_ROLE.has(w)));
}

/** Sinks that act on a value rather than store it. Mirrors the sink vocabulary used for
 *  missing-schema-validation, across the languages this detector reads. */
const CONSEQUENTIAL_SINK =
  /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork|system|popen|shell_exec|passthru|proc_open|Open3|CommandContext|StartProcess)\s*[(.]|\.(?:query|execute|executeRaw|queryRaw|raw|run|all|get)\s*\(|\b(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|createWriteStream|unlink|rmdir|open|remove|move|copy|rglob)\s*\(|\bfetch\s*\(|\bhttp\.(?:Get|Post|NewRequest\w*)\s*\(|\brequests\.\w+\s*\(/;

/**
 * Does this parameter's value reach something that acts on it, anywhere in the repository? The
 * search is by leaf name against the files that could plausibly consume the tool's arguments —
 * enough to credit `migrationArgs` flowing into `execSync`, and deliberately not a full
 * dataflow analysis, because a miss here only falls through to the other two grounds.
 */
function reachesConsequentialSink(ctx: ScanContext, paramPath: string): boolean {
  const leaf = paramPath.split(".").pop() ?? paramPath;
  if (leaf.length < 3) return false;
  const escaped = leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The parameter read (`input.migrationArgs`, `args["path"]`, `req.GetHost()`, `params.query`).
  const read = new RegExp(
    `[.\\[]\\s*["'\`]?${escaped}\\b|\\bGet${escaped.charAt(0).toUpperCase()}${escaped.slice(1)}\\s*\\(`,
    "i",
  );
  for (const file of ctx.files) {
    if (TEST_PATH.test(file.relPath)) continue;
    if (!read.test(file.content)) continue;
    if (CONSEQUENTIAL_SINK.test(file.content)) return true;
  }
  return false;
}

interface Candidate {
  /** Dotted parameter path within the tool. */
  path: string;
  /** Unbounded *volume* rather than unbounded value. */
  bulk: boolean;
  line: number;
  dialect: string;
}

/**
 * Filter one tool's unbounded parameters down to the consequential ones. `boundedSiblings` is
 * true when at least one *other* declared parameter of the same tool carries a real bound.
 */
function consequential(ctx: ScanContext, candidates: Candidate[], boundedSiblings: boolean): Candidate[] {
  if (boundedSiblings) return candidates;
  return candidates.filter(
    (c) =>
      c.bulk ||
      c.path === "additionalProperties" ||
      hasInterpretedRole(c.path) ||
      reachesConsequentialSink(ctx, c.path),
  );
}

/** A property "declares a shape" if anything at all tells a validator what to accept. */
function declaresShape(schema: unknown): boolean {
  if (!isObj(schema)) return false;
  if (typeof schema["$ref"] === "string") return true;
  if (typeNames(schema["type"]).length > 0) return true;
  if (schema["enum"] !== undefined || schema["const"] !== undefined) return true;
  return ["allOf", "anyOf", "oneOf"].some((k) => Array.isArray(schema[k]));
}

/* --------------------------------------------------------------------------------- zod */

/** Chain steps that shrink the accepted value space. */
const ZOD_BOUNDED =
  /\.(?:max|lte|lt|length|regex|uuid|ulid|cuid2?|nanoid|ip|cidr|datetime|date|time|duration|email)\s*\(/;
/** Constructors that are bounded by construction. */
const ZOD_CLOSED = /\bz(?:od)?\.(?:enum|nativeEnum|literal|boolean|null|undefined|void|never|date|instanceof)\s*\(/;
/** Constructors that accept arbitrarily large values until something bounds them. */
const ZOD_OPEN = /\bz(?:od)?\.(?:string|number|bigint|array|record|map|set|any|unknown|coerce)\s*\(/;
/** Constructors whose openness is one of *volume*: the caller decides how much arrives. */
const ZOD_BULK = /\bz(?:od)?\.(?:array|record|map|set|any|unknown)\s*\(/;
const ZOD_OBJECT = /\bz(?:od)?\.object\s*\(/;
/** An object that keeps whatever keys it was not told about — zod's `additionalProperties: true`. */
const ZOD_OPEN_OBJECT = /^\s*\.\s*(?:passthrough|catchall)\s*\(/;

/**
 * Definitions of every top-level binding in the repo, as raw source text. This is what lets a
 * constraint living in a shared helper module count: `repo: repoSlug()` is bounded because
 * `repoSlug` is, wherever it happens to be written.
 */
function collectJsDefinitions(ctx: ScanContext): Map<string, string> {
  const defs = new Map<string, string>();
  const DECL =
    /(?:^|[\n;])[ \t]*(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*/g;
  const FN = /(?:^|[\n;])[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  for (const file of ctx.files) {
    if (!JS_EXT.test(file.relPath)) continue;
    const content = file.content;
    DECL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DECL.exec(content)) !== null) {
      const name = m[1]!;
      if (!defs.has(name)) defs.set(name, captureJsStatement(content, m.index + m[0].length));
    }
    FN.lastIndex = 0;
    while ((m = FN.exec(content)) !== null) {
      const name = m[1]!;
      const paren = content.indexOf("(", m.index);
      const afterParams = paren >= 0 ? balancedEnd(content, paren) : -1;
      const brace = afterParams > 0 ? content.indexOf("{", afterParams) : -1;
      const end = brace >= 0 ? balancedEnd(content, brace) : -1;
      if (brace >= 0 && end > brace && !defs.has(name)) defs.set(name, content.slice(brace, end + 1));
    }
  }
  return defs;
}

/**
 * Text of one statement starting at `start`. Multi-line fluent chains are the norm in schema
 * modules, so a newline only terminates the statement when the next line begins a new
 * top-level construct.
 */
function captureJsStatement(content: string, start: number): string {
  const LIMIT = 2000;
  let depth = 0;
  let quote = "";
  for (let i = start; i < content.length && i - start < LIMIT; i++) {
    const c = content[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c in OPENERS) depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth < 0) return content.slice(start, i);
    } else if (depth === 0 && c === ";") return content.slice(start, i);
    else if (depth === 0 && c === "\n") {
      const rest = content.slice(i + 1);
      const nextLine = rest.match(/^[^\n]*/)?.[0] ?? "";
      if (!nextLine.trim()) return content.slice(start, i);
      const isContinuation = /^\s/.test(nextLine) || /^[.)\]}?:]/.test(nextLine.trim());
      const startsNew = /^(?:export|import|const|let|var|function|class|type|interface|enum|declare|\/\*|\/\/|})/.test(
        nextLine.trim(),
      );
      if (!isContinuation || startsNew) return content.slice(start, i);
    }
  }
  return content.slice(start, Math.min(content.length, start + LIMIT));
}

/** Object literal text of the `z.object(...)` whose match begins at `matchIdx`. */
function zodObjectBody(
  content: string,
  matchIdx: number,
): { body: string; bodyStart: number; end: number } | undefined {
  const paren = content.indexOf("(", matchIdx);
  if (paren < 0) return undefined;
  const end = balancedEnd(content, paren);
  if (end < 0) return undefined;
  const brace = content.indexOf("{", paren);
  if (brace < 0 || brace > end) return undefined;
  const braceEnd = balancedEnd(content, brace);
  if (braceEnd < 0 || braceEnd > end) return undefined;
  return { body: content.slice(brace + 1, braceEnd), bodyStart: brace + 1, end };
}

interface ZodLeaf {
  path: string;
  offset: number;
  bulk: boolean;
}

/** Unbounded leaves of one zod field expression. */
function zodUnbounded(
  expr: string,
  exprOffset: number,
  path: string,
  defs: Map<string, string>,
  seen: Set<string>,
  depth: number,
): ZodLeaf[] {
  if (depth > 5) return [];

  const objMatch = ZOD_OBJECT.exec(expr);
  if (objMatch) {
    const parsed = zodObjectBody(expr, objMatch.index);
    if (parsed) {
      const leaves = zodFields(parsed.body, exprOffset + parsed.bodyStart, path, defs, seen, depth + 1);
      // `.passthrough()` / `.catchall()` is zod's `additionalProperties: true`.
      if (ZOD_OPEN_OBJECT.test(expr.slice(parsed.end + 1))) {
        leaves.push({ path, offset: exprOffset, bulk: true });
      }
      return leaves;
    }
  }

  const chain = outerChain(expr);
  if (ZOD_CLOSED.test(chain) || ZOD_BOUNDED.test(chain)) return [];
  if (ZOD_OPEN.test(chain)) return [{ path, offset: exprOffset, bulk: ZOD_BULK.test(chain) }];

  // No zod constructor here: the field is built from a named helper. Resolve it — a bound in
  // another module is still a bound — and stay silent when it cannot be resolved.
  const id = /^([A-Za-z_$][\w$]*)/.exec(expr.trim())?.[1];
  if (id && !seen.has(id)) {
    const def = defs.get(id);
    if (def) {
      const next = new Set(seen).add(id);
      return zodUnbounded(def, exprOffset, path, defs, next, depth + 1).map((l) => ({
        path: l.path,
        offset: exprOffset,
        bulk: l.bulk,
      }));
    }
  }
  return [];
}

/** Walk the fields of a zod object literal body. */
function zodFields(
  body: string,
  bodyOffset: number,
  prefix: string,
  defs: Map<string, string>,
  seen: Set<string>,
  depth: number,
): ZodLeaf[] {
  const leaves: ZodLeaf[] = [];
  let cursor = 0;
  for (const raw of splitTopLevel(body)) {
    const at = body.indexOf(raw, cursor);
    cursor = at >= 0 ? at + raw.length : cursor;
    if (raw.startsWith("...")) continue;
    const colon = topLevelColonJs(raw);
    if (colon < 0) continue;
    const key = raw
      .slice(0, colon)
      .trim()
      .replace(/^["'`]|["'`]$/g, "");
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) continue;
    const expr = raw.slice(colon + 1).trim();
    const exprOffset = bodyOffset + (at >= 0 ? at : 0) + colon + 1;
    const path = prefix ? `${prefix}.${key}` : key;
    leaves.push(...zodUnbounded(expr, exprOffset, path, defs, seen, depth));
  }
  return leaves;
}

function topLevelColonJs(text: string): number {
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c in OPENERS) depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ":" && depth === 0) return i;
  }
  return -1;
}

/* ---------------------------------------------------------------------------- pydantic */

/**
 * Constraint keywords that place an UPPER bound. `min_length`, `ge` and `gt` are deliberately
 * absent: a floor is not a bound in the direction that matters for a row limit or a payload
 * size, so `constr(min_length=1)` and `Field(ge=1)` constrain nothing an attacker cares about.
 *
 * Note that the *constructors* — `StringConstraints(...)`, `conint(...)` — are absent too.
 * Their presence used to count as a bound on its own, which made every half-bounded field look
 * constrained: the call is where a bound may be written, not evidence that one was.
 */
const PY_UPPER_BOUND =
  /\b(?:max_length|maxLength|max_items|maxItems|max_digits|max_value|multiple_of)\s*=|\b(?:le|lt)\s*=|\b(?:pattern|regex|choices)\s*=|\bLiteral\s*\[|\bEnum\b/;
/** Annotations whose value space has no upper bound of its own. */
const PY_OPEN_TYPE =
  /^(?:str|int|float|complex|bytes|bytearray|list|List|dict|Dict|set|Set|frozenset|tuple|Tuple|Any|object|Sequence|MutableSequence|Mapping|MutableMapping|Iterable|Collection|Json|AnyStr)\b/;
/** `con*()` builders are open until one of their arguments closes them. */
const PY_OPEN_CALL = /^con(?:str|int|float|decimal|bytes|list|set|frozenset|date)\s*\(/;

/**
 * Generic containers whose *size* is the thing that needs bounding. A constraint written
 * inside their type parameters bounds one element, not the number of elements.
 */
const PY_CONTAINER_GENERIC =
  /^(?:list|List|set|Set|frozenset|FrozenSet|tuple|Tuple|Sequence|MutableSequence|Iterable|Collection|Deque|dict|Dict|Mapping|MutableMapping|DefaultDict|OrderedDict)$/;
/** `conlist(ItemType, max_length=N)` — the first argument is the item type, the rest are bounds. */
const PY_CONTAINER_CALL = /^con(?:list|set|frozenset|tuple)$/;

/** Index of the bracket closing the one at `openIdx` within a (bracket-only) annotation. */
function annotationEnd(text: string, openIdx: number): number {
  let depth = 0;
  let quote = "";
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c in OPENERS) depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/**
 * Blank out the element type of every container in a field declaration, so what remains is
 * only the constraints that apply to the container itself.
 *
 * `paths: list[Annotated[str, StringConstraints(max_length=256)]]` becomes `paths: list[…]`.
 * That is the difference between "each path is at most 256 characters" and "at most N paths
 * arrive", and only the second one bounds the request. Asking whether the parameter's type
 * carries *a* bound answers yes here, which is exactly the wrong answer.
 */
function stripContainerItems(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const head = /^([A-Za-z_][\w.]*)\s*([[(])/.exec(text.slice(i));
    if (head) {
      const name = head[1]!.split(".").pop()!;
      const open = i + head[0].length - 1;
      const close = annotationEnd(text, open);
      if (close > open) {
        const inner = text.slice(open + 1, close);
        if (PY_CONTAINER_GENERIC.test(name)) {
          out += `${head[1]}${head[2]}…${head[2] === "[" ? "]" : ")"}`;
          i = close + 1;
          continue;
        }
        if (PY_CONTAINER_CALL.test(name)) {
          // Keep every argument except the first: those are the container's own bounds.
          const rest = splitTopLevel(inner).slice(1);
          out += `${head[1]}(…${rest.length ? ", " + rest.join(", ") : ""})`;
          i = close + 1;
          continue;
        }
        // Not a container (Annotated, Optional, Field, con* scalars): recurse, keep the rest.
        out += head[0] + stripContainerItems(inner) + (head[2] === "[" ? "]" : ")");
        i = close + 1;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

/** The type an annotation ultimately declares, with Optional/Union/Annotated wrappers removed. */
function pyCoreType(annotation: string, depth = 0): string {
  const a = stripPyOptional(annotation);
  if (depth >= 4) return a;
  const annotated = /^Annotated\s*\[([\s\S]*)\]$/.exec(a);
  if (annotated) {
    const first = splitTopLevel(annotated[1]!)[0];
    if (first) return pyCoreType(first, depth + 1);
  }
  return a;
}

interface PyLine {
  text: string;
  offset: number;
}

function pyLines(content: string): PyLine[] {
  const out: PyLine[] = [];
  let offset = 0;
  for (const line of content.split("\n")) {
    out.push({ text: line, offset });
    offset += line.length + 1;
  }
  return out;
}

function pyIndent(text: string): number {
  return text.length - text.trimStart().length;
}

/** Statement text starting at `start`, continuing while brackets stay open. */
function capturePyRhs(content: string, start: number): string {
  const LIMIT = 1500;
  let depth = 0;
  let quote = "";
  for (let i = start; i < content.length && i - start < LIMIT; i++) {
    const c = content[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c in OPENERS) depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "\n" && depth <= 0) return content.slice(start, i);
  }
  return content.slice(start, Math.min(content.length, start + LIMIT));
}

/**
 * Module-level type aliases across the repo. Pydantic's idiomatic way to share a constraint is
 * `TicketKey = Annotated[str, StringConstraints(pattern=...)]` in a types module, which makes
 * every model that uses `TicketKey` constrained even though the model body shows a bare name.
 */
function collectPyAliases(ctx: ScanContext): Map<string, string> {
  const aliases = new Map<string, string>();
  const ALIAS = /(?:^|\n)([A-Za-z_]\w*)\s*(?::\s*(?:TypeAlias|typing\.TypeAlias)\s*)?=\s*/g;
  for (const file of ctx.files) {
    if (!PY_EXT.test(file.relPath)) continue;
    ALIAS.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ALIAS.exec(file.content)) !== null) {
      const name = m[1]!;
      const rhs = capturePyRhs(file.content, m.index + m[0].length);
      // Only type-shaped right-hand sides; a plain constant is not an annotation.
      if (!/^(?:Annotated|Optional|Union|Literal|List|Dict|Sequence|con\w+|constr|conint|[A-Z])/.test(rhs.trim())) {
        continue;
      }
      if (!aliases.has(name)) aliases.set(name, rhs);
    }
  }
  return aliases;
}

/** Class names in the repo whose bases match `basePattern` (one level of inheritance). */
function collectPyClasses(ctx: ScanContext, basePattern: RegExp): Set<string> {
  const direct = new Set<string>();
  const bases = new Map<string, string[]>();
  const CLASS = /(?:^|\n)\s*class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/g;
  for (const file of ctx.files) {
    if (!PY_EXT.test(file.relPath)) continue;
    CLASS.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CLASS.exec(file.content)) !== null) {
      const name = m[1]!;
      const baseList = (m[2] ?? "")
        .split(",")
        .map((b) => b.trim().replace(/^\w+\./, ""))
        .filter(Boolean);
      if (baseList.some((b) => basePattern.test(b))) direct.add(name);
      bases.set(name, baseList);
    }
  }
  // Transitively close over in-repo subclasses.
  for (let pass = 0; pass < 3; pass++) {
    for (const [name, baseList] of bases) {
      if (!direct.has(name) && baseList.some((b) => direct.has(b))) direct.add(name);
    }
  }
  return direct;
}

function stripPyOptional(ann: string): string {
  let a = ann.trim();
  for (let i = 0; i < 3; i++) {
    const m = /^(?:Optional|Union)\s*\[([\s\S]*)\]$/.exec(a);
    if (!m) break;
    const parts = splitTopLevel(m[1]!).filter((p) => p !== "None");
    if (parts.length !== 1) break;
    a = parts[0]!.trim();
  }
  return a.replace(/\s*\|\s*None$/, "").trim();
}

/** Is a pydantic field bounded, following alias indirection? */
function pyFieldBounded(annotation: string, whole: string, aliases: Map<string, string>, depth = 0): boolean {
  const ann = pyCoreType(annotation);
  // A shared alias carries its constraint with it — resolve before judging, so the model body
  // showing a bare name is not mistaken for a bare type.
  const bare = /^([A-Za-z_]\w*)$/.exec(ann)?.[1];
  if (bare && depth < 4) {
    const alias = aliases.get(bare);
    if (alias) return pyFieldBounded(alias, alias, aliases, depth + 1);
  }
  if (PY_UPPER_BOUND.test(stripContainerItems(whole))) return true;
  if (PY_OPEN_TYPE.test(ann) || PY_OPEN_CALL.test(ann)) return false;
  // A name we cannot resolve (a nested model, a third-party type): assume it constrains.
  return true;
}

/** Is the field's openness one of volume — a collection or a free-form bag, not a scalar? */
function pyFieldIsBulk(annotation: string, aliases: Map<string, string>, depth = 0): boolean {
  const ann = pyCoreType(annotation);
  const bare = /^([A-Za-z_]\w*)$/.exec(ann)?.[1];
  if (bare && depth < 4) {
    const alias = aliases.get(bare);
    if (alias) return pyFieldIsBulk(alias, aliases, depth + 1);
  }
  const head = /^([A-Za-z_][\w.]*)/.exec(ann)?.[1]?.split(".").pop() ?? "";
  return PY_CONTAINER_GENERIC.test(head) || PY_CONTAINER_CALL.test(head) || /^(?:Any|object|Json)$/.test(head);
}

interface PyBlock {
  name: string;
  bases: string[];
  headerOffset: number;
  indent: number;
  body: PyLine[];
}

/** `class` / `def` blocks with their indented bodies. */
function pyBlocks(content: string, keyword: "class" | "def"): PyBlock[] {
  const lines = pyLines(content);
  const blocks: PyBlock[] = [];
  const header =
    keyword === "class" ? /^(\s*)class\s+(\w+)\s*(?:\(([\s\S]*?)\))?\s*:/ : /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = header.exec(lines[i]!.text);
    if (!m) continue;
    const indent = m[1]!.length;
    const body: PyLine[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j]!.text;
      if (!t.trim()) {
        body.push(lines[j]!);
        continue;
      }
      if (pyIndent(t) <= indent) break;
      body.push(lines[j]!);
    }
    blocks.push({
      name: m[2] ?? "",
      bases: (m[3] ?? "")
        .split(",")
        .map((b) => b.trim().replace(/^\w+\./, ""))
        .filter(Boolean),
      headerOffset: lines[i]!.offset,
      indent,
      body,
    });
  }
  return blocks;
}

/** Join physical lines into logical ones (a field may wrap across several). */
function logicalPyLines(body: PyLine[]): PyLine[] {
  const out: PyLine[] = [];
  let buf = "";
  let offset = -1;
  let depth = 0;
  for (const line of body) {
    if (!line.text.trim()) continue;
    if (offset < 0) offset = line.offset;
    buf += (buf ? " " : "") + line.text.trim();
    for (const ch of line.text) {
      if (ch in OPENERS) depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
    }
    if (depth <= 0) {
      out.push({ text: buf, offset });
      buf = "";
      offset = -1;
      depth = 0;
    }
  }
  if (buf) out.push({ text: buf, offset: offset < 0 ? 0 : offset });
  return out;
}

function splitAnnotationDefault(text: string): { name: string; annotation: string; whole: string } | undefined {
  const colon = topLevelColonJs(text);
  if (colon < 0) return undefined;
  const name = text.slice(0, colon).trim();
  if (!/^[A-Za-z_]\w*$/.test(name) || name.startsWith("_")) return undefined;
  if (name === "model_config" || name === "Config") return undefined;
  const rest = text.slice(colon + 1);
  let depth = 0;
  let quote = "";
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c in OPENERS) depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (
      c === "=" &&
      depth === 0 &&
      rest[i + 1] !== "=" &&
      rest[i - 1] !== "!" &&
      rest[i - 1] !== "<" &&
      rest[i - 1] !== ">"
    ) {
      return { name, annotation: rest.slice(0, i).trim(), whole: text };
    }
  }
  return { name, annotation: rest.trim(), whole: text };
}

/* ------------------------------------------------ JSON Schema written as a JS/TS literal */

/**
 * A tool's JSON Schema does not have to live in a `.json` file. The MCP SDK's low-level
 * `Server` API takes tool definitions as plain objects, so the commonest way to write one is an
 * `inputSchema: { ... }` literal inside the TypeScript module that also implements the tool —
 * frequently the same module that runs the value through `execSync`. Reading JSON Schema only
 * out of `.json`/`.yaml` meant that whole idiom was invisible: not judged lenient, not judged at
 * all.
 *
 * The literal is read as *data only*. Any identifier, call or template substitution anywhere in
 * it abandons the parse and yields nothing, which is what keeps a zod raw shape
 * (`inputSchema: { text: z.string().max(200) }` — the same key, a different language) from being
 * mistaken for a JSON Schema whose properties happen to carry no keywords. Nothing parsed means
 * nothing reported.
 */
function parseJsDataLiteral(text: string, start: number): { value: unknown; end: number } | undefined {
  let i = start;
  let budget = 20000;

  const ws = (): void => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i]!)) i++;
      if (text[i] === "/" && text[i + 1] === "/") {
        const nl = text.indexOf("\n", i);
        if (nl < 0) {
          i = text.length;
          return;
        }
        i = nl + 1;
        continue;
      }
      if (text[i] === "/" && text[i + 1] === "*") {
        const e = text.indexOf("*/", i);
        if (e < 0) {
          i = text.length;
          return;
        }
        i = e + 2;
        continue;
      }
      return;
    }
  };

  const str = (): string | undefined => {
    const q = text[i];
    if (q !== '"' && q !== "'" && q !== "`") return undefined;
    let out = "";
    i++;
    while (i < text.length) {
      const c = text[i]!;
      if (c === "\\") {
        const n = text[i + 1];
        out += n === "n" ? "\n" : n === "t" ? "\t" : (n ?? "");
        i += 2;
        continue;
      }
      if (q === "`" && c === "$" && text[i + 1] === "{") return undefined; // interpolated: not data
      if (c === q) {
        i++;
        return out;
      }
      out += c;
      i++;
    }
    return undefined;
  };

  const value = (): unknown | undefined => {
    if (budget-- <= 0) return undefined;
    ws();
    const c = text[i];
    if (c === undefined) return undefined;
    if (c === '"' || c === "'" || c === "`") return str();
    if (c === "{") {
      i++;
      const obj: JsonObj = {};
      for (;;) {
        ws();
        if (text[i] === "}") {
          i++;
          return obj;
        }
        if (i >= text.length) return undefined;
        let key: string | undefined;
        if (text[i] === '"' || text[i] === "'" || text[i] === "`") key = str();
        else {
          const id = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
          if (!id) return undefined; // computed key or spread — not plain data
          key = id[0];
          i += id[0].length;
        }
        if (key === undefined) return undefined;
        ws();
        if (text[i] !== ":") return undefined;
        i++;
        const v = value();
        if (v === undefined) return undefined;
        obj[key] = v;
        ws();
        if (text[i] === ",") i++;
        else if (text[i] !== "}") return undefined;
      }
    }
    if (c === "[") {
      i++;
      const arr: unknown[] = [];
      for (;;) {
        ws();
        if (text[i] === "]") {
          i++;
          return arr;
        }
        if (i >= text.length) return undefined;
        const v = value();
        if (v === undefined) return undefined;
        arr.push(v);
        ws();
        if (text[i] === ",") i++;
        else if (text[i] !== "]") return undefined;
      }
    }
    const lit = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/.exec(text.slice(i));
    if (lit) {
      i += lit[0].length;
      const raw = lit[0];
      return raw === "true" ? true : raw === "false" ? false : raw === "null" ? null : Number(raw);
    }
    return undefined; // identifier, call, `as const`, anything not data
  };

  const v = value();
  return v === undefined ? undefined : { value: v, end: i };
}

/** JSON Schema keys that identify a schema envelope rather than an arbitrary options object. */
function looksLikeJsonSchema(v: unknown): v is JsonObj {
  if (!isObj(v)) return false;
  return isObj(v["properties"]) || (typeof v["type"] === "string" && v["type"] === "object");
}

/** Tool definitions whose schema is a JSON Schema object literal in a JS/TS module. */
function embeddedJsonSchemaTools(content: string): ToolDef[] {
  const defs: ToolDef[] = [];
  const KEY = /\b(?:inputSchema|input_schema|parameters|json_schema|jsonSchema)\s*:\s*(?=\{)/g;
  let m: RegExpExecArray | null;
  while ((m = KEY.exec(content)) !== null) {
    const parsed = parseJsDataLiteral(content, m.index + m[0].length);
    if (!parsed || !looksLikeJsonSchema(parsed.value)) continue;
    const container = parsed.value;
    const props = containerProperties(container);
    if (Object.keys(props).length === 0 && container["additionalProperties"] !== true) continue;
    // The tool's name is the nearest `name: "..."` above the schema, which is how every one of
    // these object literals is written.
    const before = content.slice(Math.max(0, m.index - 600), m.index);
    const names = [...before.matchAll(/\bname\s*:\s*["'`]([^"'`]+)["'`]/g)];
    defs.push({ name: names[names.length - 1]?.[1], container, properties: props });
    KEY.lastIndex = parsed.end;
  }
  return defs;
}

/* -------------------------------------------------------- C# attribute-declared tool schemas */

/**
 * Semantic Kernel, the .NET MCP SDK and the `AIFunction` family all declare a tool by attributing
 * a method, and each parameter's contract is whatever attributes sit in front of it. The trap is
 * that the attribute a generated codebase always carries — `[Description]` — is documentation
 * for the model, not a constraint on the value: a parameter can be exhaustively described and
 * still accept anything. The attributes that actually narrow the value space are the validation
 * ones (`[AllowedValues]`, `[RegularExpression]`, `[Range]`, `[StringLength]`, `[MaxLength]`),
 * and a schema in which some parameters carry those and others carry only prose is precisely the
 * half-bounded shape this class exists to name.
 */
const CS_TOOL_ATTR = /\[\s*(?:KernelFunction|SKFunction|McpServerTool|AIFunction|Function|Tool)\b/g;
/** Attributes that narrow the accepted value space. `Description` is deliberately absent. */
const CS_BOUND_ATTR =
  /^(?:AllowedValues|RegularExpression|Range|StringLength|MaxLength|Length|EnumDataType|DeniedValues)$/;
/** Types with no upper bound of their own. */
const CS_OPEN_TYPE =
  /^(?:string|String|int|Int32|long|Int64|short|Int16|uint|UInt32|ulong|UInt64|byte|sbyte|decimal|double|float|Single|object|dynamic|BigInteger)$/;
/** Types whose openness is one of volume. */
const CS_BULK_TYPE = /^(?:List|IList|IEnumerable|ICollection|IReadOnlyList|Dictionary|IDictionary|HashSet|Array)$/;
/** Parameters the host injects; the model never supplies them. */
const CS_INJECTED =
  /^(?:CancellationToken|Kernel|KernelArguments|IServiceProvider|ILogger|ILoggerFactory|IMcpServer|RequestContext|HttpContext)/;

interface CsParam {
  name: string;
  bounded: boolean;
  bulk: boolean;
}

interface CsTool {
  name: string;
  offset: number;
  params: CsParam[];
}

/** Skip whitespace and any run of complete `[...]` attribute groups starting at `i`. */
function csSkipAttributes(content: string, i: number): number {
  for (;;) {
    while (i < content.length && /\s/.test(content[i]!)) i++;
    if (content[i] !== "[") return i;
    const end = balancedEnd(content, i);
    if (end < 0) return i;
    i = end + 1;
  }
}

function csToolsOf(content: string): CsTool[] {
  const tools: CsTool[] = [];
  CS_TOOL_ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CS_TOOL_ATTR.exec(content)) !== null) {
    const attrEnd = balancedEnd(content, content.indexOf("[", m.index));
    if (attrEnd < 0) continue;
    const attrText = content.slice(m.index, attrEnd + 1);
    // `public Task<string> SearchAsync(` — everything up to the parameter list.
    const headStart = csSkipAttributes(content, attrEnd + 1);
    const paren = content.indexOf("(", headStart);
    if (paren < 0) continue;
    const header = content.slice(headStart, paren);
    // A method header, not a property or a field: no statement terminator may intervene.
    if (/[;{}=]/.test(header)) continue;
    const methodName = /([A-Za-z_]\w*)\s*(?:<[^<>]*>)?\s*$/.exec(header)?.[1];
    if (!methodName) continue;
    const end = balancedEnd(content, paren);
    if (end < 0) continue;

    const declared = /["']([^"']+)["']/.exec(attrText)?.[1];
    const params: CsParam[] = [];
    for (const raw of splitTopLevel(content.slice(paren + 1, end))) {
      const attrs = [...raw.matchAll(/\[\s*([A-Za-z_]\w*)/g)].map((a) => a[1]!);
      // Strip attribute groups so what remains is `Type name` (plus any default).
      let rest = raw;
      for (let guard = 0; guard < 8 && rest.trimStart().startsWith("["); guard++) {
        const open = rest.indexOf("[");
        const close = balancedEnd(rest, open);
        if (close < 0) break;
        rest = rest.slice(0, open) + rest.slice(close + 1);
      }
      rest = rest.replace(/=[\s\S]*$/, "").trim();
      const decl =
        /^(?:(?:this|params|ref|out|in)\s+)*([A-Za-z_][\w.]*(?:\s*<[\s\S]*>)?(?:\s*\[\s*\])?\s*\??)\s+([A-Za-z_]\w*)$/.exec(
          rest,
        );
      if (!decl) continue;
      const typeText = decl[1]!.trim();
      const name = decl[2]!;
      if (CS_INJECTED.test(typeText)) continue;
      const head = /^([A-Za-z_][\w.]*)/.exec(typeText)?.[1]?.split(".").pop() ?? "";
      const isArray = /\[\s*\]$/.test(typeText);
      const bulk = isArray || CS_BULK_TYPE.test(head);
      const openType = CS_OPEN_TYPE.test(head) || bulk;
      const bounded = attrs.some((a) => CS_BOUND_ATTR.test(a)) || !openType;
      params.push({ name, bounded, bulk });
    }
    if (params.length === 0) continue;
    tools.push({ name: declared ?? methodName, offset: m.index, params });
  }
  return tools;
}

/* ------------------------------------------------------------ protobuf tool request messages */

/**
 * A gRPC/Connect agent exposes its tools as protobuf messages, and the constraints live in
 * `buf.validate` (protovalidate) field options rather than in the field declaration. The shape
 * that matters is the same one as everywhere else in this class and reads just as reassuringly:
 * one field carries a careful `[(buf.validate.field).int32 = {gte: 1, lte: 1440}]` and its
 * siblings carry nothing. A constraint on one field is not a constraint on the message.
 */
const PROTO_BOUNDED_OPTION =
  /\(\s*(?:buf\.validate|validate)\.(?:field|rules)\s*\)|\(\s*validate\.rules\s*\)|\bmax_len\b|\bmax_items\b|\bconst\b|\bin\s*:/;
/** Scalar field types with no upper bound of their own. */
const PROTO_OPEN_TYPE =
  /^(?:string|bytes|int32|int64|uint32|uint64|sint32|sint64|fixed32|fixed64|sfixed32|sfixed64|float|double)$/;

interface ProtoField {
  name: string;
  bounded: boolean;
  bulk: boolean;
  offset: number;
}

interface ProtoMessage {
  name: string;
  fields: ProtoField[];
  offset: number;
}

function protoMessages(content: string): ProtoMessage[] {
  const out: ProtoMessage[] = [];
  const MSG = /\bmessage\s+([A-Za-z_]\w*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = MSG.exec(content)) !== null) {
    const brace = content.indexOf("{", m.index);
    const end = balancedEnd(content, brace);
    if (end < 0) continue;
    const body = content.slice(brace + 1, end);
    const fields: ProtoField[] = [];
    // `repeated string paths = 1 [(buf.validate.field).repeated = {max_items: 10}];`
    const FIELD =
      /(?:^|\n)\s*(?:(repeated|optional|required)\s+)?((?:map\s*<[^>]*>)|[A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*=\s*\d+\s*(\[[\s\S]*?\])?\s*;/g;
    let f: RegExpExecArray | null;
    while ((f = FIELD.exec(body)) !== null) {
      const label = f[1];
      const type = f[2]!;
      const name = f[3]!;
      if (name === "reserved" || type === "reserved" || type === "option") continue;
      const options = f[4] ?? "";
      const bulk = label === "repeated" || /^map\s*</.test(type);
      const openType = PROTO_OPEN_TYPE.test(type) || bulk;
      const bounded = PROTO_BOUNDED_OPTION.test(options) || !openType;
      fields.push({ name, bounded, bulk, offset: brace + 1 + f.index });
    }
    if (fields.length > 0) out.push({ name: m[1]!, fields, offset: m.index });
    MSG.lastIndex = end;
  }
  return out;
}

/** Message names used as an rpc request — the arguments a model actually fills in. */
function protoRequestMessages(content: string): Set<string> {
  const names = new Set<string>();
  const RPC = /\brpc\s+\w+\s*\(\s*(?:stream\s+)?([A-Za-z_][\w.]*)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = RPC.exec(content)) !== null) names.add(m[1]!.split(".").pop()!);
  return names;
}

/* ---------------------------------------------------------------------- finding assembly */

function paramFinding(
  file: ScanFile,
  line: number,
  toolName: string | undefined,
  param: string,
  what: string,
): DetectorFinding {
  const where = toolName ? `Tool "${toolName}" parameter "${param}"` : `Tool parameter "${param}"`;
  return {
    tier: "verified",
    classId: "unbounded-tool-param",
    severity: "medium",
    surfaces: file.surfaces,
    locations: [{ path: file.relPath, startLine: line, endLine: line, surface: surfaceOf(file) }],
    explanation:
      `${where} in ${file.relPath}:${line} declares no upper bound (${what}). ` +
      `An over-permissioned model can pass an arbitrarily large or arbitrary-shaped value.`,
    reproduction: {
      kind: "inspection",
      steps: [
        `Open ${file.relPath} at line ${line}.`,
        `Observe parameter "${param}" with no enum/pattern/maxLength/maximum/maxItems (or dialect equivalent).`,
        `Follow any $ref, shared helper or type alias it uses — none of them adds a bound either.`,
      ],
      expected: `The parameter accepts unbounded input.`,
    },
  };
}

function locateKeyLine(content: string, toolName: string | undefined, paramPath: string): number {
  const leaf = paramPath.split(".").pop() ?? paramPath;
  let from = 0;
  if (toolName) {
    const idx = content.indexOf(`"${toolName}"`);
    const alt = idx >= 0 ? idx : content.indexOf(toolName);
    if (alt >= 0) from = alt;
  }
  for (const needle of [`"${leaf}"`, `'${leaf}'`, `${leaf}:`]) {
    const idx = content.indexOf(needle, from);
    if (idx >= 0) return lineAtIndex(content, idx);
  }
  const idx = toolName ? content.indexOf(toolName) : -1;
  return idx >= 0 ? lineAtIndex(content, idx) : 1;
}

/* ================================================================ unbounded-tool-param */

export const unboundedToolParamDetector: Detector = {
  classIds: ["unbounded-tool-param"],
  tier: "verified",
  run(ctx: ScanContext): DetectorFinding[] {
    const findings: DetectorFinding[] = [];
    const jsDefs = collectJsDefinitions(ctx);
    const pyAliases = collectPyAliases(ctx);
    const pyModels = collectPyClasses(ctx, /^(?:BaseModel|BaseSettings|RootModel)$/);

    /** Emit one tool's unbounded parameters, after the consequence gate has had its say. */
    const emit = (
      file: ScanFile,
      toolName: string | undefined,
      candidates: Candidate[],
      boundedSiblings: boolean,
    ): void => {
      for (const c of consequential(ctx, candidates, boundedSiblings)) {
        findings.push(paramFinding(file, c.line, toolName, c.path, c.dialect));
      }
    };

    for (const file of ctx.files) {
      if (!isToolSchemaSurface(file)) continue;

      /* ---- dialect 1: JSON Schema — in a manifest, an OpenAPI operation, or a JS literal ---- */
      const structuredRoot = STRUCTURED_EXT.test(file.relPath) ? parseStructured(file) : undefined;
      const embedded = JS_EXT.test(file.relPath) ? embeddedJsonSchemaTools(file.content) : [];
      if (structuredRoot !== undefined || embedded.length > 0) {
        const isYaml = /\.ya?ml$/i.test(file.relPath);
        const manifestTools = structuredRoot !== undefined ? toolDefsOf(structuredRoot) : [];
        const openApiTools = structuredRoot !== undefined ? openApiToolDefs(structuredRoot) : [];
        for (const tool of [...manifestTools, ...openApiTools, ...embedded]) {
          // A literal in a JS module resolves `$ref` against itself; a manifest against its root.
          const root = embedded.includes(tool) ? tool.container : structuredRoot;
          const candidates: Candidate[] = [];
          let boundedParams = 0;

          /* The schema container's own `additionalProperties: true` is a bound the per-property
             walk cannot see: every declared property can be immaculate and the object still
             accepts any number of undeclared keys of any size. */
          if (tool.container?.["additionalProperties"] === true) {
            candidates.push({
              path: "additionalProperties",
              bulk: true,
              line: locateKeyLine(file.content, tool.name, "additionalProperties"),
              dialect: "JSON Schema — the object accepts arbitrary undeclared keys",
            });
          }

          for (const [param, schema] of Object.entries(tool.properties)) {
            const leaves = jsonUnboundedPaths(schema, param, { root, depth: 0, refs: new Set() }).filter(
              // Safety net for the hand-rolled YAML reader: if the parameter's own source block
              // does carry a bound, trust the text over our indentation guess. The OpenAPI shape
              // is located by its own keys, so the manifest veto does not apply.
              (leaf) =>
                !(isYaml && !openApiTools.includes(tool) && yamlParamBlockHasBound(file.content, tool.name, leaf.path)),
            );
            if (leaves.length === 0) {
              boundedParams++;
              continue;
            }
            for (const leaf of leaves) {
              candidates.push({
                path: leaf.path,
                bulk: leaf.bulk,
                line: locateKeyLine(file.content, tool.name, leaf.path),
                dialect: "JSON Schema",
              });
            }
          }
          emit(file, tool.name, candidates, boundedParams > 0);
        }
      }

      /* ---- dialect 2: zod ---- */
      if (JS_EXT.test(file.relPath) && ZOD_OBJECT.test(file.content)) {
        const content = file.content;
        const covered: [number, number][] = [];
        const re = new RegExp(ZOD_OBJECT.source, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          if (covered.some(([s, e]) => m!.index > s && m!.index < e)) continue;
          const parsed = zodObjectBody(content, m.index);
          if (!parsed) continue;
          covered.push([m.index, parsed.end]);
          const schemaName = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*$/.exec(
            content.slice(Math.max(0, m.index - 120), m.index),
          )?.[1];
          const leaves = zodFields(parsed.body, parsed.bodyStart, "", jsDefs, new Set(), 0);
          const candidates: Candidate[] = leaves.map((leaf) => ({
            path: leaf.path,
            bulk: leaf.bulk,
            line: lineAtIndex(content, leaf.offset),
            dialect: "zod schema",
          }));
          // The top-level schema's own chain: `.passthrough()` reopens everything below it.
          if (ZOD_OPEN_OBJECT.test(content.slice(parsed.end + 1, parsed.end + 40))) {
            candidates.push({
              path: "additionalProperties",
              bulk: true,
              line: lineAtIndex(content, parsed.end),
              dialect: "zod schema — `.passthrough()` keeps every undeclared key",
            });
          }
          const openFields = new Set(leaves.map((l) => l.path.split(".")[0]));
          const boundedSiblings = zodTopLevelKeys(parsed.body).some((k) => !openFields.has(k));
          emit(file, schemaName, candidates, boundedSiblings);
        }
      }

      /* ---- dialect 3: pydantic ---- */
      if (PY_EXT.test(file.relPath) && /BaseModel/.test(file.content)) {
        for (const block of pyBlocks(file.content, "class")) {
          if (!block.bases.some((b) => b === "BaseModel" || pyModels.has(b))) continue;
          const candidates: Candidate[] = [];
          let boundedParams = 0;
          for (const line of logicalPyLines(block.body)) {
            const trimmed = line.text.trim();
            if (!trimmed || /^(?:#|"""|'''|@|def\s|async\s+def\s|class\s|return\b|pass\b)/.test(trimmed)) continue;
            const field = splitAnnotationDefault(trimmed);
            if (!field || !field.annotation) continue;
            if (pyFieldBounded(field.annotation, field.whole, pyAliases)) {
              boundedParams++;
              continue;
            }
            candidates.push({
              path: field.name,
              bulk: pyFieldIsBulk(field.annotation, pyAliases),
              line: lineAtIndex(file.content, line.offset),
              dialect: "pydantic model",
            });
          }
          emit(file, block.name, candidates, boundedParams > 0);
        }
      }

      /* ---- dialect 4: C# tool attributes ---- */
      if (CS_EXT.test(file.relPath)) {
        for (const tool of csToolsOf(file.content)) {
          const candidates: Candidate[] = [];
          let boundedParams = 0;
          for (const p of tool.params) {
            if (p.bounded) {
              boundedParams++;
              continue;
            }
            const at = file.content.indexOf(p.name, tool.offset);
            candidates.push({
              path: p.name,
              bulk: p.bulk,
              line: lineAtIndex(file.content, at >= 0 ? at : tool.offset),
              dialect: "C# tool attributes — [Description] documents a parameter, it does not bound it",
            });
          }
          emit(file, tool.name, candidates, boundedParams > 0);
        }
      }

      /* ---- dialect 5: protobuf tool request messages ---- */
      if (PROTO_EXT.test(file.relPath)) {
        const requests = protoRequestMessages(file.content);
        for (const msg of protoMessages(file.content)) {
          if (!requests.has(msg.name) && !/Request$|Args$|Input$|Params$/.test(msg.name)) continue;
          const candidates: Candidate[] = [];
          let boundedParams = 0;
          for (const f of msg.fields) {
            if (f.bounded) {
              boundedParams++;
              continue;
            }
            candidates.push({
              path: f.name,
              bulk: f.bulk,
              line: lineAtIndex(file.content, f.offset),
              dialect: "protobuf field options",
            });
          }
          emit(file, msg.name, candidates, boundedParams > 0);
        }
      }
    }
    return findings;
  },
};

/** Top-level keys of a zod object literal body, by the same splitting rules `zodFields` uses. */
function zodTopLevelKeys(body: string): string[] {
  const keys: string[] = [];
  for (const raw of splitTopLevel(body)) {
    if (raw.startsWith("...")) continue;
    const colon = topLevelColonJs(raw);
    if (colon < 0) continue;
    const key = raw
      .slice(0, colon)
      .trim()
      .replace(/^["'`]|["'`]$/g, "");
    if (/^[A-Za-z_$][\w$]*$/.test(key)) keys.push(key);
  }
  return keys;
}

/** Bound keywords that are meaningful for a schema of the given declared type. */
const YAML_BOUND_BY_TYPE: Record<string, RegExp> = {
  string: /^(?:maxLength|max_length|pattern|format)\s*:/,
  number: /^(?:maximum|exclusiveMaximum)\s*:/,
  integer: /^(?:maximum|exclusiveMaximum)\s*:/,
  array: /^(?:maxItems|max_items)\s*:/,
  object: /^(?:maxProperties|max_properties)\s*:/,
};
/** Bounds that apply whatever the declared type is. */
const YAML_BOUND_ANY =
  /^(?:enum|const|\$ref|allOf|anyOf|oneOf|maxLength|max_length|pattern|format|maximum|exclusiveMaximum|maxItems|max_items|maxProperties|max_properties)\s*:/;

/**
 * Does the parameter's own indented block in the raw YAML carry a bound? Consulted only to
 * veto a finding: the mini-reader guesses at nesting, and the source text is the better
 * authority when the two disagree. A parameter whose key cannot be found in the text at all
 * was invented by a bad parse, so it is vetoed too.
 *
 * Only the parameter's DIRECT children count, and only bounds that mean something for its
 * declared type. Scanning the whole subtree — as this used to — made `maxLength` on an array's
 * `items` veto the array's missing `maxItems`, and made an `enum` on one property of an
 * `additionalProperties: true` object veto the open bag it sat inside. Both are exactly the
 * cases where an item-level constraint is mistaken for a container-level one.
 */
function yamlParamBlockHasBound(content: string, toolName: string | undefined, paramPath: string): boolean {
  const leaf = (paramPath.split(".").pop() ?? paramPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = content.split("\n");
  let from = 0;
  if (toolName) {
    const idx = lines.findIndex((l) => l.includes(toolName));
    if (idx > 0) from = idx;
  }
  const keyRe = new RegExp(`^(\\s*)(?:-\\s*(?:name\\s*:\\s*)?)?["']?${leaf}["']?\\s*:`);
  for (let i = from; i < lines.length; i++) {
    if (!keyRe.exec(lines[i]!)) continue;
    const indent = lines[i]!.length - lines[i]!.trimStart().length;

    const own: string[] = [];
    const inline = lines[i]!.slice(lines[i]!.indexOf(":") + 1).trim();
    if (inline.startsWith("{")) own.push(...splitTopLevel(inline.replace(/^\{|\}$/g, "")));
    let childIndent = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (!line.trim()) continue;
      const ind = line.length - line.trimStart().length;
      if (ind <= indent) break;
      if (childIndent < 0) childIndent = ind;
      if (ind === childIndent) own.push(line.trim().replace(/^-\s*/, ""));
    }

    // An object that explicitly accepts arbitrary keys is unbounded no matter how carefully
    // its declared properties are constrained.
    if (own.some((l) => /^additionalProperties\s*:\s*true\b/i.test(l))) return false;

    const declared = own.map((l) => /^type\s*:\s*["']?(\w+)/.exec(l)?.[1]).find(Boolean);
    const relevant = declared ? (YAML_BOUND_BY_TYPE[declared] ?? YAML_BOUND_ANY) : YAML_BOUND_ANY;
    return own.some((l) => relevant.test(l) || /^(?:enum|const|\$ref|allOf|anyOf|oneOf)\s*:/.test(l));
  }
  return true; // key absent from the source: our parse produced it, so do not report it
}

function parseStructured(file: ScanFile): unknown {
  try {
    return JSON.parse(file.content);
  } catch {
    /* fall through to YAML */
  }
  if (!/\.ya?ml$/i.test(file.relPath)) return undefined;
  try {
    return parseMiniYaml(file.content);
  } catch {
    return undefined;
  }
}

/* ============================================================ missing-schema-validation */

/**
 * A validation *application* — the schema being run against a value. `JSON.parse` and friends
 * are excluded: they decode, they do not check.
 */
const JS_PARSE_APPLY =
  /(?<!\bJSON)(?<!\bpath)(?<!\burl)(?<!\bDate)(?<!\bquerystring)(?<!\bqs)(?<!\bYAML)(?<!\byaml)\.(?:parse|safeParse|parseAsync|safeParseAsync)\s*\(/;
const JS_VALIDATE_APPLY =
  /\.(?:validate|validateAsync|validateSync|validateOrReject|cast|assertValid|isValid)\s*\(|\bcheckSchema\s*\(|\bvalidationResult\s*\(|\bmatchedData\s*\(|\bcelebrate\s*\(|\bassertType\s*\(|\bValidationPipe\b/;
const JS_VALIDATION_NAME = /valid|check|sanit|schema|celebrate|ajv|zod|joi|yup|dto|guard|assert|parse|verif|coerce/i;

const JS_SINK =
  /\.(?:find|findOne|findMany|findFirst|findAndModify|aggregate|updateOne|updateMany|replaceOne|deleteOne|deleteMany|countDocuments|distinct|insertOne|insertMany|bulkWrite|query|execute|executeRaw|queryRaw|createQueryBuilder|raw)\s*\(|\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(|\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|unlink|rmdir)\s*\(|\bfetch\s*\(/g;

const REQ_INPUT = /\b(?:req|request|ctx|context|event)\s*\.\s*(?:body|query|params|rawBody)\b/;

/** Identifiers holding request-controlled data inside a handler body. */
function taintedNames(body: string): string[] {
  const names = new Set<string>();
  const DESTRUCTURE =
    /(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:req|request|ctx|context|event)\s*\.\s*(?:body|query|params|rawBody)/g;
  let m: RegExpExecArray | null;
  while ((m = DESTRUCTURE.exec(body)) !== null) {
    const target = m[1]!;
    if (target.startsWith("{") || target.startsWith("[")) {
      for (const part of splitTopLevel(target.slice(1, -1))) {
        const id = /^([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?/.exec(part.replace(/^\.\.\./, ""));
        if (id) names.add(id[2] ?? id[1]!);
      }
    } else names.add(target);
  }
  return [...names];
}

function sinkReceivesTaint(body: string, tainted: string[]): boolean {
  JS_SINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JS_SINK.exec(body)) !== null) {
    const paren = body.indexOf("(", m.index + m[0].length - 1);
    if (paren < 0) continue;
    const call = callArgs(body, paren);
    if (!call) continue;
    const argText = call.args.join(",");
    if (REQ_INPUT.test(argText)) return true;
    if (tainted.some((n) => new RegExp(`\\b${n}\\b`).test(argText))) return true;
  }
  return false;
}

function isValidatingMiddleware(argText: string, defs: Map<string, string>): boolean {
  const text = argText.trim();
  // A route-options object (Fastify `schema`, Hapi `validate`) is framework-level validation:
  // the framework rejects a non-conforming body before the handler is ever entered.
  if (text.startsWith("{")) {
    return /\b(?:schema|validate|validatorCompiler|preValidation|attachValidation)\s*[:,}]/.test(text);
  }
  const id = /^([A-Za-z_$][\w$]*)/.exec(text)?.[1];
  if (!id) return false;
  if (JS_VALIDATION_NAME.test(id)) return true;
  const def = defs.get(id);
  return !!def && (JS_PARSE_APPLY.test(def) || JS_VALIDATE_APPLY.test(def));
}

function isStringLiteral(argText: string): boolean {
  return /^["'`]/.test(argText.trim());
}

function isFunctionArg(argText: string): boolean {
  const t = argText.trim();
  return t.includes("=>") || /^(?:async\s+)?function\b/.test(t) || /^[A-Za-z_$][\w$]*$/.test(t);
}

/**
 * The name under which a handler receives the whole argument object, or undefined when it does
 * not receive one opaquely — because it destructures a declared key list, or because the handler
 * is a reference whose signature is not visible here (in which case we assume it is declared).
 */
function opaqueArgBag(handlerText: string): string | undefined {
  const t = handlerText.trim();
  let params: string | undefined;
  if (/^(?:async\s+)?\(/.test(t) || /^(?:async\s+)?function\b[^(]*\(/.test(t)) {
    const open = t.indexOf("(");
    const end = balancedEnd(t, open);
    if (end < 0) return undefined;
    params = t.slice(open + 1, end);
  } else {
    // `async args => …`
    params = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(t)?.[1];
  }
  if (params === undefined) return undefined;
  const first = splitTopLevel(params)[0]?.trim();
  if (!first) return undefined;
  if (first.startsWith("{") || first.startsWith("[")) return undefined; // keys declared inline
  return /^([A-Za-z_$][\w$]*)/.exec(first)?.[1];
}

/**
 * Bindings that hold a *compiled* schema validator — `ajv.compile(schema)`, `ajv.getSchema(id)`,
 * TypeBox's `TypeCompiler.Compile`. Calling one of these applies a schema to a value just as
 * surely as `.parse()` does; it simply does not spell the application with a method name, which
 * is why a repository whose only validator was an ajv-compiled function read as one that
 * validated nothing anywhere — and its single validated entry point read as the violation.
 */
function collectCompiledValidators(ctx: ScanContext): Set<string> {
  const names = new Set<string>();
  const RE =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?:await\s+)?(?:[A-Za-z_$][\w$.]*\s*\.\s*(?:compile|compileAsync|getSchema)|TypeCompiler\s*\.\s*Compile|ajv\w*\s*\.\s*\w+)\s*\(/g;
  for (const file of ctx.files) {
    if (!JS_EXT.test(file.relPath)) continue;
    RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(file.content)) !== null) names.add(m[1]!);
  }
  return names;
}

function msvFinding(file: ScanFile, line: number, what: string, why: string, step: string): DetectorFinding {
  return {
    tier: "verified",
    classId: "missing-schema-validation",
    severity: "medium",
    surfaces: file.surfaces,
    locations: [{ path: file.relPath, startLine: line, endLine: line, surface: surfaceOf(file) }],
    explanation:
      `${what} in ${file.relPath}:${line} ${why} ` +
      `Model- or client-controlled input reaches execution without a runtime shape check.`,
    reproduction: {
      kind: "inspection",
      steps: [`Open ${file.relPath} at line ${line}.`, step],
      expected: `Unvalidated input reaches the handler.`,
    },
  };
}

export const missingSchemaValidationDetector: Detector = {
  classIds: ["missing-schema-validation"],
  tier: "verified",
  run(ctx: ScanContext): DetectorFinding[] {
    const findings: DetectorFinding[] = [];
    const jsDefs = collectJsDefinitions(ctx);
    const pyTypedDicts = collectPyClasses(ctx, /^TypedDict$/);
    const pyModels = collectPyClasses(ctx, /^(?:BaseModel|BaseSettings|RootModel)$/);
    const compiledValidators = collectCompiledValidators(ctx);

    /* Does the repository apply a schema to a value ANYWHERE? A schema that is declared,
       exported and even advertised to the client but never run against the incoming value
       validates nothing — this is the signal that separates it from a validated one. A
       compiled validator counts: `validateArgs(args)` where `validateArgs = ajv.compile(schema)`
       is a schema being run, spelled without a method name. */
    const repoAppliesValidation = ctx.files.some(
      (f) =>
        JS_EXT.test(f.relPath) &&
        (JS_PARSE_APPLY.test(f.content) ||
          JS_VALIDATE_APPLY.test(f.content) ||
          [...compiledValidators].some((n) => new RegExp(`\\b${n}\\s*\\(`).test(f.content))),
    );

    for (const file of ctx.files) {
      if (!isHandlerSurface(file)) continue;
      const content = file.content;

      /* ---- shape 1: a tool manifest that declares no usable parameter schema ---- */
      if (STRUCTURED_EXT.test(file.relPath)) {
        const root = parseStructured(file);
        if (root !== undefined) {
          const tools = toolDefsOf(root);
          /*
           * Is this document the place schemas are declared at all? A manifest in which not one
           * entry carries a `parameters`/`inputSchema` key is a CATALOGUE — a list of the tool
           * names and human descriptions this server publishes, with the argument contracts kept
           * in the code that implements them (an MCP SDK registration, a dispatch table). The
           * absence of a schema key in a file that was never a schema file is evidence of
           * nothing, and reporting every entry of one reports the file format rather than a
           * defect: it fires on all four tools of a server whose dispatcher is in fact the
           * strictest thing in the repository.
           *
           * When SOME entries declare a schema and others do not, the omission is meaningful
           * again — the author was declaring schemas here and skipped these — and it is reported.
           */
          const isCatalogue = tools.length > 0 && tools.every((t) => !t.container);
          for (const tool of tools) {
            const line = locateKeyLine(content, tool.name, tool.name ?? "");
            if (!tool.container) {
              if (isCatalogue) continue;
              findings.push(
                msvFinding(
                  file,
                  line,
                  `Tool "${tool.name}"`,
                  "declares no parameter schema at all, although sibling tools in the same manifest do.",
                  `Observe no "parameters"/"inputSchema" for this tool where its siblings have one.`,
                ),
              );
              continue;
            }
            const props = tool.properties;
            if (Object.keys(props).length === 0) {
              // An explicitly closed, empty object is a deliberate "takes no arguments".
              if (tool.container["type"] === "object" && tool.container["additionalProperties"] === false) continue;
              findings.push(
                msvFinding(
                  file,
                  line,
                  `Tool "${tool.name}"`,
                  "declares a schema with no properties and no closed object contract.",
                  `Observe an empty parameter schema that constrains nothing.`,
                ),
              );
              continue;
            }
            for (const [param, schema] of Object.entries(props)) {
              if (declaresShape(schema)) continue;
              findings.push(
                msvFinding(
                  file,
                  locateKeyLine(content, tool.name, param),
                  `Tool "${tool.name}" parameter "${param}"`,
                  "has no declared type, $ref, enum or combinator.",
                  `Observe parameter "${param}" with nothing a validator could enforce.`,
                ),
              );
            }
          }
        }
      }

      if (JS_EXT.test(file.relPath)) {
        /* ---- shape 2: an MCP tool registered without an input schema ---- */
        const TOOL_REG = /\b[A-Za-z_$][\w$.]*\.\s*(tool|registerTool|addTool)\s*\(/g;
        let m: RegExpExecArray | null;
        while ((m = TOOL_REG.exec(content)) !== null) {
          const paren = content.indexOf("(", m.index + m[0].length - 1);
          const call = callArgs(content, paren);
          if (!call || call.args.length < 2) continue;
          const middle = call.args.slice(1, -1).filter((a) => !isStringLiteral(a));
          if (middle.length > 0) continue; // a schema (zod, JSON Schema, {inputSchema}) is supplied
          const handler = call.args[call.args.length - 1]!;
          if (!isFunctionArg(handler)) continue;
          /*
           * The gap is an *opaque bag*: the handler takes the whole model-authored argument
           * object under one name and reads whatever keys it likes off it, so nothing — not the
           * SDK, not the signature — states what may arrive. A handler that destructures a fixed
           * key list (`async ({ id }) => …`) has written its accepted shape into the signature;
           * only those keys are ever bound, and there is no undeclared bag to validate. Treating
           * the two alike reported the SDK's own no-argument overload as a missing schema.
           */
          const bag = opaqueArgBag(handler);
          if (!bag) continue;
          if (!new RegExp(`\\b${bag}\\s*(?:\\.\\s*[A-Za-z_$]|\\[)`).test(handler)) continue;
          findings.push(
            msvFinding(
              file,
              lineAtIndex(content, m.index),
              `Tool registration ${call.args[0]}`,
              `supplies a handler but no input schema, and the handler reads arbitrary keys off "${bag}", so nothing states what may arrive.`,
              `Observe the registration passing only a name and a handler, and "${bag}" being subscripted for keys no schema declares.`,
            ),
          );
        }

        /* ---- shape 3: an HTTP route whose raw body reaches a sink unvalidated ---- */
        const ROUTE = /\b([A-Za-z_$][\w$.]*)\.\s*(get|post|put|patch|delete|options|head|all)\s*\(/g;
        const routerUseValidates = (() => {
          const USE = /\b[A-Za-z_$][\w$.]*\.\s*use\s*\(/g;
          let u: RegExpExecArray | null;
          while ((u = USE.exec(content)) !== null) {
            const p = content.indexOf("(", u.index + u[0].length - 1);
            const c = callArgs(content, p);
            if (c && c.args.some((a) => isValidatingMiddleware(a, jsDefs))) return true;
          }
          return false;
        })();

        while ((m = ROUTE.exec(content)) !== null) {
          const paren = content.indexOf("(", m.index + m[0].length - 1);
          const call = callArgs(content, paren);
          if (!call || call.args.length < 2) continue;
          if (!isStringLiteral(call.args[0]!)) continue;
          const handler = call.args[call.args.length - 1]!;
          if (!REQ_INPUT.test(handler)) continue;
          if (routerUseValidates) continue;
          if (call.args.slice(1, -1).some((a) => isValidatingMiddleware(a, jsDefs))) continue;
          if (JS_PARSE_APPLY.test(handler) || JS_VALIDATE_APPLY.test(handler)) continue;
          if (!sinkReceivesTaint(handler, taintedNames(handler))) continue;
          findings.push(
            msvFinding(
              file,
              lineAtIndex(content, m.index),
              `Route ${call.args[0]}`,
              "reads the request body/query/params and passes it into a query or command with no schema applied.",
              `Trace the destructured request data into the call that executes it — nothing validates it first.`,
            ),
          );
        }

        /* ---- shape 4: a schema declared but never applied on the dispatch path ---- */
        if (!repoAppliesValidation) {
          const RAW_FORWARD =
            /\b([A-Za-z_$][\w$]*)\s*:\s*(?:unknown|any)\b[\s\S]{0,900}?\b([A-Za-z_$][\w$]*)\s*\(\s*\1\s*(?:as\s+[\w<>.[\]|]+\s*)?[,)]/g;
          let r: RegExpExecArray | null;
          while ((r = RAW_FORWARD.exec(content)) !== null) {
            // Handing the value to a validator is not forwarding it unvalidated — it is the
            // check. Only a call that consumes the raw value onward counts.
            const callee = r[2]!;
            if (JS_VALIDATION_NAME.test(callee) || compiledValidators.has(callee)) continue;
            findings.push(
              msvFinding(
                file,
                lineAtIndex(content, r.index),
                `Handler input "${r[1]}"`,
                "is typed as unknown/any and forwarded to the tool handler without any schema being applied to it anywhere in the repository.",
                `Search the repository for a .parse/.safeParse/.validate call on this value — the declared schema is advertised but never run.`,
              ),
            );
          }
        }
      }

      /* ---- shape 5: Python handlers whose annotation performs no runtime check ---- */
      if (PY_EXT.test(file.relPath)) {
        findings.push(...pythonHandlerFindings(file, pyTypedDicts, pyModels));
      }

      /* ---- shape 6: a Ruby route taking model-authored JSON straight into a sink ---- */
      if (RB_EXT.test(file.relPath)) {
        findings.push(...rubyRouteFindings(file));
      }
    }
    return findings;
  },
};

const PY_SINK =
  /\b(?:subprocess\.\w+|os\.system|os\.popen|os\.remove|os\.unlink|eval|exec|open|shutil\.\w+|requests\.\w+|httpx\.\w+)\s*\(|\.\s*(?:execute|executemany|fetchall|fetchone|find|find_one|update_one|update_many|delete_one|delete_many|insert_one|insert_many|aggregate|raw)\s*\(/;
const PY_VALIDATE =
  /\.\s*(?:model_validate|model_validate_json|parse_obj|parse_raw|validate_python|from_dict)\s*\(|\bTypeAdapter\s*\(|\bjsonschema\s*\.\s*validate\s*\(|\bparse_obj_as\s*\(|\b\w*[Ss]chema\s*\([^)]*\)\s*\.\s*load\s*\(|\bvalidate\s*\(/;
/** Annotations that exist only for the type checker and are gone at run time. */
const PY_ERASED = /^(?:dict|Dict|Any|object|Mapping|MutableMapping|MutableJson|Json|JSON)\b/;
/**
 * The framework's *raw request* object. Annotating a handler `request: Request` is the one
 * FastAPI/Starlette/Flask signature that opts OUT of validation: the pydantic body model that
 * would have parsed the payload is never named, so `await request.json()` yields whatever the
 * caller sent. It is easy to read as the safest signature in the file — it is typed, the type is
 * real, and the repository often does define the model and even advertise its JSON Schema — but
 * the model is never applied to the value on this path, so it constrains nothing at run time.
 */
const PY_RAW_REQUEST = /^(?:Request|HttpRequest|WSGIRequest|ASGIRequest|StarletteRequest)$/;
/** Reading the undecoded payload off that object. */
function pyRawBodyRead(name: string): RegExp {
  return new RegExp(`\\b${name}\\s*\\.\\s*(?:json|body|form|data|stream|get_json|get_data|read)\\b`);
}

function pythonHandlerFindings(file: ScanFile, typedDicts: Set<string>, models: Set<string>): DetectorFinding[] {
  const out: DetectorFinding[] = [];
  const content = file.content;
  for (const block of pyBlocks(content, "def")) {
    const paren = content.indexOf("(", block.headerOffset);
    if (paren < 0) continue;
    const end = balancedEnd(content, paren);
    if (end < 0) continue;
    const params = splitTopLevel(content.slice(paren + 1, end));
    const bodyText = block.body.map((l) => l.text).join("\n");
    if (!PY_SINK.test(bodyText)) continue;
    if (PY_VALIDATE.test(bodyText)) continue;

    for (const raw of params) {
      const field = splitAnnotationDefault(raw);
      if (!field) continue;
      if (field.name === "self" || field.name === "cls") continue;
      // A framework-injected dependency is not client input.
      if (/\bDepends\s*\(|\bSecurity\s*\(|\bProvide\b/.test(raw)) continue;
      const ann = stripPyOptional(field.annotation);
      const bare = /^([A-Za-z_]\w*)/.exec(ann)?.[1] ?? "";
      // A pydantic model IS the runtime check — FastAPI and pydantic parse before the body runs.
      if (models.has(bare) || /BaseModel/.test(ann)) continue;
      const erased = PY_ERASED.test(ann) || typedDicts.has(bare);
      const rawRequest = PY_RAW_REQUEST.test(bare);
      if (!erased && !rawRequest) continue;

      if (rawRequest) {
        // The evidence is the raw payload being read off the request object and then used as an
        // untyped bag — no declared model ever touches the value on this path.
        if (!pyRawBodyRead(field.name).test(bodyText)) continue;
        if (!/\[\s*["']|\.\s*get\s*\(/.test(bodyText)) continue;
        out.push(
          msvFinding(
            file,
            lineAtIndex(content, block.headerOffset),
            `Handler "${block.name}" parameter "${field.name}"`,
            `takes the raw ${bare} object and reads the body itself, so no declared model is ever applied to the value on this path.`,
            `Observe the body being read raw and subscripted straight into a query, file write or subprocess call — any model the repository declares for this tool is advertised, never enforced here.`,
          ),
        );
        break;
      }

      // Require the parameter to actually be used as a data bag reaching the effect.
      const used = new RegExp(`\\b${field.name}\\s*(?:\\[|\\.\\s*get\\s*\\()|\\*\\*\\s*${field.name}\\b`).test(
        bodyText,
      );
      if (!used) continue;
      out.push(
        msvFinding(
          file,
          lineAtIndex(content, block.headerOffset),
          `Handler "${block.name}" parameter "${field.name}"`,
          `is annotated "${ann}", which is erased at run time and checks nothing.`,
          `Observe the parameter being subscripted straight into a query, file write or subprocess call.`,
        ),
      );
      break; // one finding per handler is enough to describe the gap
    }
  }
  return out;
}

/* ------------------------------------------------------------------ Ruby route handlers */

/**
 * A Sinatra-style route block is a tool endpoint written without a schema layer: `post '/…' do`
 * opens a block, `JSON.parse(request.body.read)` turns the model's message into a Hash, and the
 * Hash is indexed on the spot. Nothing in that path is a contract — `JSON.parse` decodes, it
 * does not check, and Ruby's `Hash#fetch`/`#[]` will hand back whatever key was sent — so when
 * the values become argv for `Open3`, a `chdir`, or SQL, the model chooses them outright.
 *
 * What WOULD be a check, and is credited: a schema library run against the payload (dry-schema,
 * json-schema, JSONSchemer, an ActiveModel contract) or Rails strong parameters
 * (`params.require(:x).permit(...)`), anywhere in the block.
 */
const RB_ROUTE = /^([ \t]*)(get|post|put|patch|delete|options)\s+['"]([^'"]*)['"]\s+do\b/gm;
/** The model's message entering the block undecoded. */
const RB_RAW_INPUT =
  /\bJSON\s*\.\s*parse\s*\(|\brequest\s*\.\s*body\s*\.\s*read\b|\brequest\s*\.\s*(?:body|params)\b|\bparams\s*\[/;
/** Somewhere the value is acted on rather than stored. */
const RB_SINK =
  /\bOpen3\s*\.\s*\w+|\bIO\s*\.\s*popen\s*\(|\b(?:system|exec|spawn)\s*[(\s]['"]|%x[({[]|`[^`\n]*#\{|\bKernel\s*\.\s*(?:system|exec|spawn)\b|\.\s*(?:execute|exec_query|select_all|find_by_sql)\s*\(|\bFile\s*\.\s*(?:write|open|delete|read)\s*\(|\bFileUtils\s*\.\s*\w+/;
/** A real shape check applied to the payload. */
const RB_VALIDATE =
  /\bJSON::Validator\b|\bJSONSchemer\b|\bDry::(?:Schema|Validation)\b|\b\w*(?:schema|contract|validator)\w*\s*\.\s*call\s*\(|\.\s*permit\s*\(|\.\s*require\s*\(\s*:|\bvalid\?\b|\bvalidate!\s*\(|\bActiveModel::Validations\b/i;

/** Route blocks of a Ruby file, delimited by the `end` that returns to the opener's indent. */
function rubyRouteBlocks(content: string): { method: string; path: string; body: string; offset: number }[] {
  const out: { method: string; path: string; body: string; offset: number }[] = [];
  const lines = content.split("\n");
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) {
    offsets.push(acc);
    acc += l.length + 1;
  }
  RB_ROUTE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RB_ROUTE.exec(content)) !== null) {
    const startLine = lineAtIndex(content, m.index) - 1;
    const indent = m[1]!.length;
    let endLine = lines.length - 1;
    for (let i = startLine + 1; i < lines.length; i++) {
      const text = lines[i]!;
      if (!text.trim()) continue;
      const ind = text.length - text.trimStart().length;
      if (ind === indent && /^end\b/.test(text.trim())) {
        endLine = i;
        break;
      }
    }
    out.push({
      method: m[2]!,
      path: m[3]!,
      body: lines.slice(startLine + 1, endLine).join("\n"),
      offset: offsets[startLine] ?? m.index,
    });
  }
  return out;
}

function rubyRouteFindings(file: ScanFile): DetectorFinding[] {
  const out: DetectorFinding[] = [];
  for (const route of rubyRouteBlocks(file.content)) {
    if (!RB_RAW_INPUT.test(route.body)) continue;
    if (!RB_SINK.test(route.body)) continue;
    if (RB_VALIDATE.test(route.body)) continue;
    out.push(
      msvFinding(
        file,
        lineAtIndex(file.content, route.offset),
        `Route ${route.method.toUpperCase()} "${route.path}"`,
        "decodes the request body and passes the resulting values into a command or query with no schema applied to them.",
        `Trace the parsed body into the call that executes it — JSON.parse decodes the message, nothing checks its shape.`,
      ),
    );
  }
  return out;
}
