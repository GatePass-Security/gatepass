import type { Finding, SuggestedFix } from "@gatepass/findings";

/**
 * Suggested-fix generation (FR-012).
 *
 * Two rules govern everything in this file, and they are the reason it looks the way it does.
 *
 * 1. **A `diff` must be applicable.** A `diff` fix is rendered as a GitHub ```suggestion```
 *    block, which a reviewer commits with one click and no further reading. So a `diff` is
 *    only ever produced when this module can derive, from the finding's ACTUAL SOURCE, an
 *    exact anchor range and literal lines that are correct on their own. Everything else is
 *    `agent_guidance` — prose for the developer or their own coding agent. The findings
 *    schema enforces the pairing; this module never has to be trusted on its own.
 *
 * 2. **Never present a guess as a fix.** If a correct fix needs a value only a human can
 *    choose — the origins in a CORS allow-list, the exact version to pin, the predicate in
 *    an RLS policy — that value does not get invented here. A placeholder domain committed
 *    into a reviewer's branch is worse than no suggestion, because it looks finished.
 *
 * Consequence: exactly one class (`rls-gap`) yields a `diff` today, because it is the only
 * one whose safe first step is fully determined by the source. The other eleven get
 * class-specific, location-anchored guidance. That ratio is the honest one; inflating it
 * would mean shipping fixes that need a human's judgement while claiming they do not.
 *
 * All twelve emitted classes are covered. `undefined` means "this module has never heard of
 * this class", not "there is nothing to say".
 */

export type { SuggestedFix } from "@gatepass/findings";

/**
 * Read access to the files the scan ran over. Guidance is derived from source, not from the
 * finding's explanation prose — parsing a human-readable sentence to recover a table name
 * couples the fix to the exact wording of a message, and breaks the moment someone improves
 * that wording. Optional: without it, source-derived fixes degrade to guidance rather than
 * disappearing.
 */
export interface FixSource {
  read(path: string): string | undefined;
}

/** Build a `FixSource` over an in-memory map (the scan pipeline's file set). */
export function fixSourceFrom(files: ReadonlyMap<string, string>): FixSource {
  return { read: (path) => files.get(path) };
}

function guidance(content: string): SuggestedFix {
  return { kind: "agent_guidance", content };
}

/** `path:line` of the finding's primary location — every message is anchored to it. */
function at(finding: Finding): string {
  const loc = finding.locations[0]!;
  return `${loc.path}:${loc.startLine}`;
}

/** Research-tier findings are probabilistic; guidance must not read like a verified one. */
function confirmFirst(finding: Finding): string {
  return finding.tier === "research"
    ? " This is a research-tier finding, so confirm the behaviour before changing anything — the pattern below is what to do if it holds."
    : "";
}

// --------------------------------------------------------------------------------------
// rls-gap — the one class with a mechanically safe edit
// --------------------------------------------------------------------------------------

/**
 * A column name that plausibly scopes rows to a tenant. Anchored to the start of a line OR
 * to a comma, because a single-line `create table t (id int, user_id uuid)` puts every
 * column after the first on the same line — a line-anchored match silently reports "no
 * scoping column" for exactly the compact DDL people write by hand.
 */
const SCOPING_COLUMN = /(?:^|,)\s*"?(tenant_id|org_id|organization_id|owner_id|user_id|account_id|customer_id)"?\s/im;

/**
 * Find the end of the `create table` statement that starts at `startLine`: the first `;` at
 * parenthesis depth zero, skipping string/identifier literals and `--` comments. Returns the
 * 1-indexed line of that terminator, plus the parenthesised column list.
 *
 * Anchoring on the terminator (not the `create table` line) is what makes the insertion
 * valid SQL: dropping `alter table` in the middle of a multi-line DDL statement would not be.
 */
function createTableExtent(content: string, startOffset: number): { endLine: number; columns: string } | undefined {
  let depth = 0;
  let columnsStart = -1;
  let columnsEnd = -1;
  let quote: string | null = null;

  for (let i = startOffset; i < content.length; i++) {
    const ch = content[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "-" && content[i + 1] === "-") {
      const nl = content.indexOf("\n", i);
      if (nl === -1) return undefined;
      i = nl;
      continue;
    }
    if (ch === "(") {
      if (depth === 0 && columnsStart === -1) columnsStart = i + 1;
      depth++;
      continue;
    }
    if (ch === ")") {
      depth--;
      if (depth === 0 && columnsEnd === -1) columnsEnd = i;
      continue;
    }
    if (ch === ";" && depth === 0) {
      return {
        endLine: lineOf(content, i),
        columns: columnsStart >= 0 && columnsEnd > columnsStart ? content.slice(columnsStart, columnsEnd) : "",
      };
    }
  }
  return undefined;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function offsetOfLine(content: string, line: number): number | undefined {
  if (line < 1) return undefined;
  let offset = 0;
  for (let n = 1; n < line; n++) {
    const nl = content.indexOf("\n", offset);
    if (nl === -1) return undefined;
    offset = nl + 1;
  }
  return offset <= content.length ? offset : undefined;
}

const RLS_POLICY_NOTE =
  "Enabling row-level security is the half of this fix that is mechanically safe: with RLS on " +
  "and no policy, PostgreSQL denies every non-owner role by default, so the table fails closed " +
  "rather than open. The policy predicate is not safe to generate — it depends on how this " +
  "application identifies a tenant — so it ships commented out for you to complete.";

function rlsGapFix(finding: Finding, source: FixSource | undefined): SuggestedFix {
  const loc = finding.locations[0]!;
  const content = source?.read(loc.path);
  const fallback = guidance(
    `Enable row-level security on the table created at ${at(finding)} and add a policy that scopes ` +
      `rows to the caller's tenant:\n\n` +
      `  alter table <table> enable row level security;\n` +
      `  create policy <table>_tenant_isolation on <table>\n    using (<tenant column> = <current tenant>);\n\n` +
      `${RLS_POLICY_NOTE} Enable RLS first, then add the policy in the same migration so the table is ` +
      `never deployed open.`,
  );
  if (!content) return fallback;

  const offset = offsetOfLine(content, loc.startLine);
  if (offset === undefined) return fallback;

  // Re-derive the table name from the source at the finding's location — not from the
  // explanation string, which is a human-facing message and free to change.
  const head = /^[^\S\n]*create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(\w+)["`]?/i.exec(content.slice(offset));
  if (!head) return fallback;
  const table = head[1]!;

  const extent = createTableExtent(content, offset);
  if (!extent || extent.endLine < loc.startLine) return fallback;

  const column = SCOPING_COLUMN.exec(extent.columns)?.[1];
  const policyHint = column
    ? `-- Candidate scoping column on "${table}": ${column}.`
    : `-- No obvious scoping column was found on "${table}" — choose the predicate that matches your tenancy model.`;

  const insertedLines = [
    "",
    `alter table ${table} enable row level security;`,
    "",
    "-- Gatepass does not generate the policy predicate. Complete and uncomment this before",
    "-- deploying: until a policy exists, RLS denies every non-owner role on this table.",
    policyHint,
    `-- create policy ${table}_tenant_isolation on ${table}`,
    `--   using (${column ?? "<tenant column>"} = <the current tenant for this request>);`,
  ].join("\n");

  return {
    kind: "diff",
    content:
      `Enable row-level security on "${table}" immediately after its definition, then add a tenant ` +
      `policy. ${RLS_POLICY_NOTE}`,
    edit: {
      path: loc.path,
      startLine: loc.startLine,
      endLine: extent.endLine,
      operation: "insert_after",
      insertedLines,
    },
  };
}

// --------------------------------------------------------------------------------------
// Tool-definition classes — guidance derived from the parsed tool, not from prose
// --------------------------------------------------------------------------------------

interface ToolDef {
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  inputSchema?: { properties?: Record<string, unknown> };
}

function paramsOf(tool: ToolDef): [string, Record<string, unknown>][] {
  const props = tool.parameters ?? tool.inputSchema?.properties ?? {};
  return Object.entries(props).filter(([, v]) => v && typeof v === "object") as [string, Record<string, unknown>][];
}

/**
 * The tool a finding points at, recovered from the file the detector read. Detectors anchor
 * tool-definition findings at the line where the tool's `"name"` appears, so that line is the
 * key — no name is smuggled through the explanation text.
 */
function toolAtLine(source: FixSource | undefined, path: string, line: number): ToolDef | undefined {
  const content = source?.read(path);
  if (!content) return undefined;
  let parsed: { tools?: ToolDef[] };
  try {
    parsed = JSON.parse(content) as { tools?: ToolDef[] };
  } catch {
    return undefined;
  }
  return (parsed.tools ?? []).find((t) => {
    if (!t.name) return false;
    const idx = content.indexOf(`"${t.name}"`);
    return idx >= 0 && lineOf(content, idx) === line;
  });
}

/** The bound that fits each JSON-Schema type, so guidance names the right key. */
const BOUND_FOR_TYPE: Record<string, string> = {
  string: "`maxLength` (or `enum` / `pattern` when the set of valid values is known)",
  array: "`maxItems` (and a bounded `items` schema)",
  number: "`maximum` (and `minimum`)",
  integer: "`maximum` (and `minimum`)",
};

function unboundedToolParamFix(finding: Finding, source: FixSource | undefined): SuggestedFix {
  const loc = finding.locations[0]!;
  const tool = toolAtLine(source, loc.path, loc.startLine);
  const unbounded = tool
    ? paramsOf(tool).filter(([, s]) => {
        if (s["enum"]) return false;
        const t = s["type"];
        if (t === "string") return s["maxLength"] === undefined && s["pattern"] === undefined;
        if (t === "array") return s["maxItems"] === undefined;
        if (t === "number" || t === "integer") return s["maximum"] === undefined;
        return false;
      })
    : [];

  const perParam = unbounded
    .map(([name, s]) => `  • "${name}" (${String(s["type"])}) — add ${BOUND_FOR_TYPE[String(s["type"])] ?? "a bound"}`)
    .join("\n");

  return guidance(
    `Bound the parameters of ${tool?.name ? `tool "${tool.name}"` : "this tool"} in ${at(finding)}.\n\n` +
      (perParam
        ? `${perParam}\n\n`
        : "For strings set `maxLength` (or `enum`/`pattern`), for arrays set `maxItems`, for numbers " +
          "set `maximum` and `minimum`.\n\n") +
      "Pick limits from what the handler can actually process, not from what feels large — the bound " +
      "is what stops a model from passing a value the tool was never sized for. Declaring the bound in " +
      "the schema is not enough on its own: the server must reject out-of-range input rather than " +
      "trusting the caller to honour the schema.",
  );
}

function missingSchemaValidationFix(finding: Finding, source: FixSource | undefined): SuggestedFix {
  const loc = finding.locations[0]!;
  const tool = toolAtLine(source, loc.path, loc.startLine);
  const params = tool ? paramsOf(tool) : [];
  const untyped = params.filter(([, s]) => typeof s["type"] !== "string").map(([n]) => `"${n}"`);

  const specifics =
    params.length === 0
      ? "This tool declares no parameter schema at all, so nothing constrains what reaches the handler. " +
        "Add a `parameters` (or `inputSchema.properties`) object describing every argument it accepts."
      : untyped.length > 0
        ? `These parameters have no declared \`type\`: ${untyped.join(", ")}. Give each one a type, and a ` +
          `bound or \`enum\` where the valid set is known.`
        : "Give every parameter a declared `type`, and a bound or `enum` where the valid set is known.";

  return guidance(
    `Declare and enforce a schema for ${tool?.name ? `tool "${tool.name}"` : "this tool"} in ${at(finding)}.\n\n` +
      `${specifics}\n\n` +
      "Then validate at the boundary: parse the incoming arguments against the schema inside the handler " +
      "(zod, pydantic, or your MCP SDK's validator) and reject on failure. A schema the runtime never " +
      "checks is documentation, not validation.",
  );
}

function hbvFix(finding: Finding, source: FixSource | undefined): SuggestedFix {
  const loc = finding.locations[0]!;
  const tool = toolAtLine(source, loc.path, loc.startLine);
  const named = tool?.name ? `Tool "${tool.name}"` : "This tool";

  return guidance(
    `${named} in ${at(finding)} pairs a broad capability with a description too vague to scope it, so the ` +
      `model fills the gap with the most capable reading it can justify.${confirmFirst(finding)}\n\n` +
      "Two changes, both on the definition:\n" +
      "  1. Rewrite the description to state exactly what the tool does, what it must never be used for, " +
      "and which resources it can reach. Write it for a caller who will take it literally, because one will.\n" +
      "  2. Constrain the parameters so the narrow reading is the only one the schema permits — `enum` " +
      "for a fixed set, `pattern` for a shape, `maximum`/`maxItems`/`maxLength` for size.\n\n" +
      "If the tool genuinely needs broad reach, split it into narrow tools instead of documenting the breadth away.",
  );
}

// --------------------------------------------------------------------------------------
// Everything else
// --------------------------------------------------------------------------------------

const FIXES: Record<string, (finding: Finding, source: FixSource | undefined) => SuggestedFix> = {
  "rls-gap": rlsGapFix,
  "unbounded-tool-param": unboundedToolParamFix,
  "missing-schema-validation": missingSchemaValidationFix,
  hbv: hbvFix,

  /*
   * No edit: the allow-list is the fix, and its contents are a fact about the deployment that
   * this module does not know. Emitting `["https://app.example.com"]` as a suggestion would put
   * a stranger's domain into a reviewer's branch looking like a considered choice.
   */
  "cors-misconfig": (finding) =>
    guidance(
      `Replace the permissive CORS origin at ${at(finding)} with an explicit allow-list of the origins ` +
        `that are genuinely allowed to read these responses. Gatepass does not fill that list in — the ` +
        `correct origins are a property of your deployment, and a placeholder domain committed as a "fix" ` +
        `would be worse than the wildcard it replaced.\n\n` +
        "Source the list from configuration (an environment variable read at startup), compare the request's " +
        "`Origin` against it, and echo back only that exact origin — never `*`. Add `Vary: Origin` so a shared " +
        "cache cannot serve one origin's response to another.\n\n" +
        "If credentials are enabled on this endpoint, treat it as urgent: a wildcard origin combined with " +
        "credentials is rejected by browsers as spec-invalid, and every workaround for that rejection " +
        "(reflecting whatever `Origin` arrives) exposes authenticated responses to any site.",
    ),

  /*
   * No edit: pinning requires knowing which published version is actually safe, which needs a
   * registry lookup this offline pass does not make. And the finding points into package.json,
   * so anything comment-shaped would produce invalid JSON if applied.
   */
  "unpinned-dependency": (finding) =>
    guidance(
      `Pin the dependency at ${at(finding)} to an exact version you have reviewed — \`"1.2.3"\`, not \`"*"\`, ` +
        `\`"latest"\`, or an \`x\`-range.\n\n` +
        "Gatepass does not choose the version: picking one means confirming the package is the one you " +
        "intended and that the release is not compromised, and that is a registry lookup plus a judgement, " +
        "not a text substitution.\n\n" +
        "Then commit the lockfile and install with `npm ci` / `pnpm install --frozen-lockfile` in CI. A pinned " +
        "range with no lockfile still lets transitive dependencies float, which is the same exposure one level down.",
    ),

  /*
   * No edit by design: the code change is the smaller half of this fix, and shipping an edit
   * would imply deleting the literal is sufficient. It is not — the credential is already
   * disclosed to everyone with repository (or bundle) access, and stays valid until rotated.
   */
  "exposed-secret": (finding) =>
    guidance(
      `Rotate this credential first. Removing the value at ${at(finding)} does not fix anything on its own: ` +
        `it has been readable by everyone with access to this repository, and it remains valid until it is ` +
        `revoked at the issuer. Deleting it from the working tree also leaves it in git history.\n\n` +
        "In order:\n" +
        "  1. Revoke the credential at the provider and issue a replacement.\n" +
        "  2. Move the new value into the deployment's secret store and read it at runtime (`process.env` / " +
        "your platform's secret manager). Never commit it.\n" +
        "  3. Remove the literal from source, and purge it from history if the repository is or ever was " +
        "public or widely cloned.\n" +
        "  4. Check the provider's audit log for use of the old credential during the exposure window.\n\n" +
        "If this was found in a built bundle, treat it as public: anything shipped to a browser has already " +
        "been served to every visitor.",
    ),

  "unauth-mcp-transport": (finding) =>
    guidance(
      `The MCP transport at ${at(finding)} is bound to the network with no authentication registered anywhere ` +
        `in this server file, so anyone who can reach the port can call every tool it exposes.\n\n` +
        "Add authentication in front of the transport, not inside individual tool handlers — one missed handler " +
        "is the whole server. Verify a bearer token (or your platform's OAuth/mTLS) on connection and reject " +
        "before dispatch. Gatepass does not generate this because the credential source is yours to choose.\n\n" +
        "Until that is in place, bind the transport to loopback rather than `0.0.0.0`, or use stdio, so the " +
        "exposure is not reachable off-host.",
    ),

  "tool-poisoning": (finding) =>
    guidance(
      `The tool description at ${at(finding)} contains instructions aimed at the model rather than at a human ` +
        `reader — the shape of a prompt-injection payload delivered through a tool definition.` +
        `${confirmFirst(finding)}\n\n` +
        "What to do:\n" +
        "  1. Read the description as the model receives it and delete anything that instructs, constrains, " +
        "or misdirects the caller. A description should say what the tool does — nothing else.\n" +
        "  2. If this definition came from a third-party server, treat it as untrusted input and pin the server " +
        "to a reviewed version; a description can change under you between calls.\n" +
        "  3. Stop concatenating tool descriptions into the system prompt unescaped, so a future poisoned " +
        "description cannot reach the model as instruction text.\n\n" +
        "Gatepass will not rewrite the description: deciding which words were the payload and which were the " +
        "genuine documentation needs a human who knows what the tool is for.",
    ),

  "cross-surface-scope-mismatch": (finding) => {
    const [tool, client] = finding.locations;
    return guidance(
      `The tool defined at ${tool ? `${tool.path}:${tool.startLine}` : at(finding)} presents as scoped to a ` +
        `single tenant, but the data client backing it at ` +
        `${client ? `${client.path}:${client.startLine}` : "the correlated location"} carries no scoping. The ` +
        `tool's own signature is what makes this dangerous: callers, and the model, will trust the scoping it ` +
        `advertises.${confirmFirst(finding)}\n\n` +
        "Close it at the data layer, not the tool layer — a check in the handler is one refactor away from " +
        "being bypassed:\n" +
        "  • Enable row-level security on the tables this client reaches and set the tenant on the session " +
        "(`set local` / `auth.uid()`), so the database enforces the boundary.\n" +
        "  • Or give the tool a client constructed per request with the caller's own credentials, instead of a " +
        "shared service-role connection.\n\n" +
        "Then add a test that calls this tool as tenant A and asserts it cannot see tenant B's rows.",
    );
  },

  "confused-deputy": (finding) =>
    guidance(
      `The handler at ${at(finding)} lets a caller borrow this server's authority — either by forwarding the ` +
        `caller's inbound credential to an outbound request, or by using an ambient privileged token against a ` +
        `target the caller supplies.${confirmFirst(finding)}\n\n` +
        "Both need the same discipline:\n" +
        "  • Never forward an inbound `Authorization` header onward. Exchange it for a token scoped to the " +
        "downstream service and to that caller's own permissions.\n" +
        "  • Validate caller-supplied URLs/hosts against an allow-list before the request, and re-validate after " +
        "any redirect — a permitted host that redirects is the standard bypass.\n" +
        "  • Keep privileged credentials off any code path a caller can steer. If a call needs the service's own " +
        "identity, its target must be fixed in code, not taken from arguments.",
    ),

  "over-permissioned-loop": (finding) =>
    guidance(
      `The agent loop at ${at(finding)} invokes tools with no iteration bound and no exit condition, so a ` +
        `mistaken plan repeats at machine speed with whatever authority the loop holds.${confirmFirst(finding)}\n\n` +
        "Add three limits, all of them:\n" +
        "  1. A hard maximum iteration count that ends the loop and returns — not a `continue`.\n" +
        "  2. A budget (tokens, wall-clock, or tool calls) checked each pass, so a loop that makes no progress " +
        "still terminates.\n" +
        "  3. A narrowed tool set for this loop specifically. An autonomous loop should hold the smallest set " +
        "of tools that can finish its task, and destructive tools should require a human step rather than being " +
        "reachable from inside it.",
    ),
};

/**
 * Generate the suggested fix for a finding, or `undefined` for a class this module does not
 * know. `source` gives access to the scanned files so the fix is derived from real code;
 * without it, source-derived fixes degrade to guidance rather than to a wrong edit.
 */
export function generateSuggestedFix(finding: Finding, source?: FixSource): SuggestedFix | undefined {
  return FIXES[finding.classId]?.(finding, source);
}

/** The classes this module can produce guidance for. Used by tests to prove full coverage. */
export const FIXED_CLASS_IDS: readonly string[] = Object.keys(FIXES).sort();
