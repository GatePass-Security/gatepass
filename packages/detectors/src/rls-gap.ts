import type { Detector, DetectorFinding, ScanContext, ScanFile } from "@gatepass/engine";
import { lineAtIndex } from "@gatepass/engine";
import type { Surface } from "@gatepass/findings";

/**
 * Verified detector: a multi-tenant table or collection is reachable without a rule that
 * scopes rows to their tenant.
 *
 * "Without RLS" is only the most obvious way to arrive there, and a detector that checks only
 * for a missing `enable row level security` misses the three shapes that show up most often in
 * generated schemas:
 *
 *   - RLS enabled with no policy ever attached to the table;
 *   - a policy whose predicate is effectively `using (true)`, which reads as protection and
 *     enforces nothing;
 *   - RLS enabled in one migration and disabled again by a later one.
 *
 * All three fall out of the same model: replay every RLS-affecting statement in the repository
 * in migration order and judge the FINAL state of each table. That model is also what keeps the
 * two look-alikes clean — a policy defined in a different migration file from its table still
 * counts, and a backfill migration that drops RLS and restores it before commit ends in the
 * enabled state, so it is not a gap.
 *
 * Two further guards on precision. A table with no tenant-discriminating column has nothing for
 * a policy to separate — a currency or country lookup table is not a leak — so it is never
 * reported. And a predicate is judged "effectively true" only when the whole expression reduces
 * to a constant, never merely because it mentions `true` somewhere: `using (tenant_id = ... and
 * is_active = true)` is a real tenant filter.
 *
 * Document stores are covered by the same idea: a Firestore/Realtime rule that allows an
 * unconditional read of a path scoped to a tenant is the same gap in a different dialect.
 */

/* ------------------------------------------------------------------------------- helpers */

interface Loc {
  file: ScanFile;
  offset: number;
}

function normIdent(raw: string): string {
  return raw
    .trim()
    .replace(/^["`[]|["`\]]$/g, "")
    .replace(/^public\./i, "")
    .toLowerCase();
}

/** Index of the `}` (or `)`) closing the bracket at `idx`, counting that bracket kind only. */
function bracketEnd(content: string, idx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = idx; i < content.length; i++) {
    const c = content[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Blank every SQL comment, preserving byte offsets and line breaks so reported lines still point
 * at real source. Without this the column list is read through whatever a comment happens to
 * contain: a `-- denormalised for reporting; do not join on this` sitting between two columns
 * swallows the column that follows it, and the table it was documenting reads as having no
 * tenant discriminator at all — so the one table in the file that most needs a policy is the one
 * silently exempted. A comment must never be able to hide a column.
 */
function blankSqlComments(src: string): string {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== "\n") out[i] = " ";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * Row-level security is a PostgreSQL feature. Demanding a policy on a schema written for a
 * database that has none asks for a statement the engine would reject, so the "missing RLS"
 * judgement is only meaningful where RLS exists. The test is deliberately asymmetric: a file is
 * exempted only when it carries syntax that positively rules PostgreSQL out AND carries no
 * PostgreSQL marker of its own, so an ordinary portable schema still gets judged.
 */
const PG_DIALECT =
  /\brow\s+level\s+security\b|\bcreate\s+policy\b|\b(?:big|small)?serial\b|\btimestamptz\b|\bjsonb\b|\buuid\b|\bgen_random_uuid\b|\buuid_generate\w*\b|\bcurrent_setting\b|\bcitext\b|\btsvector\b|::|\btext\s*\[\s*\]/i;
const SQLITE_DIALECT =
  /\bautoincrement\b|\bunixepoch\s*\(|\bpragma\s+\w|\bsqlite_\w|\bwithout\s+rowid\b|\bjulianday\s*\(|\bstrftime\s*\(/i;
const MYSQL_DIALECT =
  /\bauto_increment\b|\bengine\s*=\s*\w|\bunsigned\b|\btinyint\b|\bmediumtext\b|\blongtext\b|\bdatetime\s*\(\s*\d\s*\)/i;

function dialectHasRls(content: string): boolean {
  if (PG_DIALECT.test(content)) return true;
  return !SQLITE_DIALECT.test(content) && !MYSQL_DIALECT.test(content);
}

/** Split on top-level commas (parens respected). */
function splitColumns(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let quote = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/* --------------------------------------------------------------------- tenancy vocabulary */

/**
 * A column that discriminates one customer's rows from another's. This is what makes a table
 * multi-tenant; without one there is nothing for row-level security to separate.
 */
const TENANT_STEM =
  "(?:tenant|org|organisation|organization|workspace|account|company|customer|client|team|project|owner|user|member|store|merchant|site|subscriber|patient|school)";
const TENANT_COLUMN = new RegExp(`^${TENANT_STEM}(?:s)?_?(?:id|uuid|key|ref|slug|code)?$`, "i");
const TENANT_TABLE = new RegExp(`^${TENANT_STEM}(?:s|es)?$`, "i");
/** Provenance columns name a person but do not scope the row to them. */
const AUDIT_COLUMN = /^(?:created|updated|modified|deleted|inserted|changed|last_modified|approved|reviewed)_by/i;

function isTenantColumn(name: string): boolean {
  const n = normIdent(name);
  if (AUDIT_COLUMN.test(n)) return false;
  return TENANT_COLUMN.test(n);
}

/* ------------------------------------------------------------------------- SQL statements */

interface Policy {
  name: string;
  command: string;
  permissive: boolean;
  using?: string;
  withCheck?: string;
  loc: Loc;
}

interface TableState {
  name: string;
  columns: Set<string>;
  refTenantTable: boolean;
  firstLoc: Loc;
  createLoc?: Loc;
  rlsEnabled: boolean;
  /** Where the statement that produced the current enabled/disabled state lives. */
  rlsStateLoc?: Loc;
  policies: Map<string, Policy>;
  /** Does any migration that touches this table target a database that HAS row level security? */
  rlsCapable: boolean;
}

type SqlEvent =
  | { kind: "create"; table: string; body: string; loc: Loc }
  | { kind: "column"; table: string; column: string; loc: Loc }
  | { kind: "rls"; table: string; action: "enable" | "disable"; loc: Loc }
  | { kind: "policy"; table: string; policy: Policy; loc: Loc }
  | { kind: "droppolicy"; table: string; name: string; loc: Loc };

const CREATE_TABLE =
  /\bcreate\s+(?:(?:global|local)\s+)?(?:temp(?:orary)?\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?("(?:[^"]+)"|`[^`]+`|[\w.]+)\s*\(/gi;
const RLS_TOGGLE =
  /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?("(?:[^"]+)"|`[^`]+`|[\w.]+)\s+(enable|disable)\s+row\s+level\s+security/gi;
const ADD_COLUMN =
  /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?("(?:[^"]+)"|`[^`]+`|[\w.]+)\s+(?:add|alter)\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?("(?:[^"]+)"|[\w]+)/gi;
const CREATE_POLICY =
  /\bcreate\s+policy\s+(?:if\s+not\s+exists\s+)?("(?:[^"]+)"|[\w]+)\s+on\s+("(?:[^"]+)"|`[^`]+`|[\w.]+)([\s\S]*?);/gi;
const DROP_POLICY = /\bdrop\s+policy\s+(?:if\s+exists\s+)?("(?:[^"]+)"|[\w]+)\s+on\s+("(?:[^"]+)"|`[^`]+`|[\w.]+)/gi;

/** The parenthesised expression following `keyword`, or undefined. */
function clauseExpr(tail: string, keyword: RegExp): string | undefined {
  const m = keyword.exec(tail);
  if (!m) return undefined;
  const paren = tail.indexOf("(", m.index + m[0].length - 1);
  if (paren < 0) return undefined;
  const end = bracketEnd(tail, paren, "(", ")");
  if (end < 0) return undefined;
  return tail.slice(paren + 1, end);
}

/**
 * Does this predicate reduce to a constant? Only an expression that IS `true` (modulo
 * parentheses and whitespace) counts — an expression that merely contains the word does not,
 * or every `and is_active = true` clause would read as a wide-open policy.
 */
function isConstantTrue(expr: string | undefined): boolean {
  if (expr === undefined) return true; // a read policy with no USING clause is unconditional
  let e = expr
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  for (let i = 0; i < 5 && e.startsWith("(") && bracketEnd(e, 0, "(", ")") === e.length - 1; i++) {
    e = e.slice(1, -1).trim();
  }
  return e === "true" || e === "1=1" || e === "1 = 1" || e === "'t'" || e === "";
}

const READ_COMMANDS = new Set(["all", "select"]);

function collectSqlEvents(file: ScanFile): SqlEvent[] {
  // Offsets are preserved by the blanking, so every `loc` still indexes the real source.
  const content = blankSqlComments(file.content);
  const events: SqlEvent[] = [];
  const loc = (offset: number): Loc => ({ file, offset });
  let m: RegExpExecArray | null;

  CREATE_TABLE.lastIndex = 0;
  while ((m = CREATE_TABLE.exec(content)) !== null) {
    const paren = m.index + m[0].length - 1;
    const end = bracketEnd(content, paren, "(", ")");
    const body = end > paren ? content.slice(paren + 1, end) : "";
    events.push({ kind: "create", table: normIdent(m[1]!), body, loc: loc(m.index) });
  }
  RLS_TOGGLE.lastIndex = 0;
  while ((m = RLS_TOGGLE.exec(content)) !== null) {
    events.push({
      kind: "rls",
      table: normIdent(m[1]!),
      action: m[2]!.toLowerCase() as "enable" | "disable",
      loc: loc(m.index),
    });
  }
  ADD_COLUMN.lastIndex = 0;
  while ((m = ADD_COLUMN.exec(content)) !== null) {
    const column = normIdent(m[2]!);
    if (column === "row" || column === "column") continue;
    events.push({ kind: "column", table: normIdent(m[1]!), column, loc: loc(m.index) });
  }
  CREATE_POLICY.lastIndex = 0;
  while ((m = CREATE_POLICY.exec(content)) !== null) {
    const tail = m[3] ?? "";
    events.push({
      kind: "policy",
      table: normIdent(m[2]!),
      loc: loc(m.index),
      policy: {
        name: normIdent(m[1]!),
        command: (/\bfor\s+(all|select|insert|update|delete)\b/i.exec(tail)?.[1] ?? "all").toLowerCase(),
        permissive: !/\bas\s+restrictive\b/i.test(tail),
        using: clauseExpr(tail, /\busing\s*\(/i),
        withCheck: clauseExpr(tail, /\bwith\s+check\s*\(/i),
        loc: loc(m.index),
      },
    });
  }
  DROP_POLICY.lastIndex = 0;
  while ((m = DROP_POLICY.exec(content)) !== null) {
    events.push({ kind: "droppolicy", table: normIdent(m[2]!), name: normIdent(m[1]!), loc: loc(m.index) });
  }

  return events.sort((a, b) => a.loc.offset - b.loc.offset);
}

const TABLE_CONSTRAINT = /^(?:constraint|primary\s+key|unique|foreign\s+key|check|exclude|like|index)\b/i;

function columnsOf(body: string): { columns: string[]; refsTenantTable: boolean } {
  const columns: string[] = [];
  let refsTenantTable = false;
  for (const part of splitColumns(body)) {
    const ref = /\breferences\s+("(?:[^"]+)"|`[^`]+`|[\w.]+)/i.exec(part);
    if (ref && TENANT_TABLE.test(normIdent(ref[1]!))) refsTenantTable = true;
    if (TABLE_CONSTRAINT.test(part)) continue;
    const name = /^("(?:[^"]+)"|`[^`]+`|[\w]+)/.exec(part)?.[1];
    if (name) columns.push(normIdent(name));
  }
  return { columns, refsTenantTable };
}

/** Replay every RLS-affecting statement in the repo, in migration order. */
function replaySql(ctx: ScanContext): Map<string, TableState> {
  const tables = new Map<string, TableState>();
  const sqlFiles = ctx.files
    .filter((f) => /\.sql$/i.test(f.relPath))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  const ensure = (name: string, loc: Loc): TableState => {
    let t = tables.get(name);
    if (!t) {
      t = {
        name,
        columns: new Set(),
        refTenantTable: false,
        firstLoc: loc,
        rlsEnabled: false,
        policies: new Map(),
        rlsCapable: false,
      };
      tables.set(name, t);
    }
    return t;
  };

  for (const file of sqlFiles) {
    const capable = dialectHasRls(file.content);
    for (const ev of collectSqlEvents(file)) {
      const t = ensure(ev.table, ev.loc);
      t.rlsCapable ||= capable;
      switch (ev.kind) {
        case "create": {
          const { columns, refsTenantTable } = columnsOf(ev.body);
          for (const c of columns) t.columns.add(c);
          t.refTenantTable ||= refsTenantTable;
          t.createLoc = ev.loc;
          break;
        }
        case "column":
          t.columns.add(ev.column);
          break;
        case "rls":
          t.rlsEnabled = ev.action === "enable";
          t.rlsStateLoc = ev.loc;
          break;
        case "policy":
          t.policies.set(ev.policy.name, ev.policy);
          // A policy predicate naming a tenant column is evidence the table is tenant-scoped,
          // even when the CREATE TABLE lives in a migration outside this scan.
          for (const expr of [ev.policy.using, ev.policy.withCheck]) {
            for (const ident of expr?.match(/[A-Za-z_][\w]*/g) ?? []) {
              if (isTenantColumn(ident)) t.columns.add(normIdent(ident));
            }
          }
          break;
        case "droppolicy":
          t.policies.delete(ev.name);
          break;
      }
    }
  }
  return tables;
}

/* ------------------------------------------------------------------- document-store rules */

interface RuleAllow {
  path: string;
  ops: string[];
  condition?: string;
  offset: number;
}

const RULES_FILE = /\.rules$/i;
const TENANT_SEGMENT = new RegExp(`^${TENANT_STEM}(?:s|es)?$`, "i");

/** Strip the fixed Firestore preamble so its `{database}` wildcard is not read as tenancy. */
function normalizeRulePath(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  const docsIdx = segments.indexOf("documents");
  if (segments[0] === "databases" && docsIdx > 0) return segments.slice(docsIdx + 1);
  return segments;
}

/**
 * Is this path a per-tenant location? Either it names a tenant collection, or a document under
 * it is keyed by a wildcard that is not the leaf — i.e. the rule spans many owners at once.
 */
function isTenantScopedPath(path: string): boolean {
  const segments = normalizeRulePath(path);
  if (segments.some((s) => TENANT_SEGMENT.test(s))) return true;
  return segments.slice(0, -1).some((s) => /^\{[^}]*\}$/.test(s));
}

function collectRuleAllows(content: string): RuleAllow[] {
  const out: RuleAllow[] = [];
  const MATCH = /\bmatch\s+([^\s{}]+(?:\{[^}]*\}[^\s{}]*)*)\s*\{/g;
  const ALLOW = /\ballow\s+([a-z]+(?:\s*,\s*[a-z]+)*)\s*(?::\s*if\s+([\s\S]*?))?;/gi;

  const walk = (start: number, end: number, prefix: string): void => {
    const nested: [number, number][] = [];
    MATCH.lastIndex = start;
    let m: RegExpExecArray | null;
    while ((m = MATCH.exec(content)) !== null && m.index < end) {
      const brace = m.index + m[0].length - 1;
      const bEnd = bracketEnd(content, brace, "{", "}");
      if (bEnd < 0 || bEnd > end) break;
      nested.push([m.index, bEnd]);
      walk(brace + 1, bEnd, `${prefix}/${m[1]!}`.replace(/\/+/g, "/"));
      MATCH.lastIndex = bEnd;
    }
    ALLOW.lastIndex = start;
    while ((m = ALLOW.exec(content)) !== null && m.index < end) {
      const at = m.index;
      if (nested.some(([s, e]) => at > s && at < e)) continue;
      out.push({
        path: prefix,
        ops: m[1]!.split(",").map((o) => o.trim().toLowerCase()),
        condition: m[2]?.trim(),
        offset: at,
      });
    }
  };

  walk(0, content.length, "");
  return out;
}

function isUnconditional(condition: string | undefined): boolean {
  if (condition === undefined) return true; // `allow read;` — no guard at all
  const c = condition
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^\(+|\)+$/g, "");
  return c === "true" || c === "1 == 1";
}

/* ------------------------------------------ ORM tenancy scope vs. the raw query builder */

/**
 * Tenancy is often enforced nowhere near the database. An Eloquent global scope, a Django
 * manager, a Rails `default_scope` — each silently appends `where tenant_id = ?` to every query
 * *that goes through the ORM*. Read the model in isolation and the isolation looks total, which
 * is exactly why the bypass is so easy to write and so hard to see in review: the moment some
 * hot path drops to the raw query builder (`DB::table('invoices')`, `Model.objects.raw`,
 * `find_by_sql`, a hand-written `SELECT`) the scope is simply not in the call path, and the
 * query returns every tenant's rows. Nothing in the raw statement looks wrong — the tenancy it
 * is missing was never written there in the first place.
 *
 * So the finding is a *pair*: a table the ORM declares as tenant-scoped, and a raw path to that
 * same table with no tenant predicate of its own. Either half alone is unremarkable.
 */
const PHP_EXT = /\.php$/i;
const TENANT_NAMED = new RegExp(TENANT_STEM, "i");

/** Extent of the statement starting at `idx`: to the next `;` outside brackets and strings. */
function statementExtent(content: string, idx: number): string {
  let depth = 0;
  let quote = "";
  for (let i = idx; i < content.length && i - idx < 4000; i++) {
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
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth <= 0) return content.slice(idx, i);
  }
  return content.slice(idx, Math.min(content.length, idx + 4000));
}

/** Does this fragment narrow rows to a tenant — by column, by scope helper, or by name? */
function mentionsTenant(fragment: string): boolean {
  for (const m of fragment.matchAll(/['"]([\w.]+)['"]/g)) {
    const ident = m[1]!.split(".").pop()!;
    if (isTenantColumn(ident)) return true;
  }
  for (const m of fragment.matchAll(/\b(\w+)\s*(?:=|=>|,|\))/g)) {
    if (isTenantColumn(m[1]!)) return true;
  }
  return /\b(?:forTenant|whereBelongsTo|scopeTenant|tenantScoped|withTenant)\b/i.test(fragment);
}

/** Class bodies in a PHP file, keyed by class name. */
function phpClassBodies(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const CLASS = /\bclass\s+(\w+)\b[^{;]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = CLASS.exec(content)) !== null) {
    const brace = content.indexOf("{", m.index);
    const end = bracketEnd(content, brace, "{", "}");
    if (end < 0) continue;
    out.set(m[1]!, content.slice(brace, end));
    CLASS.lastIndex = end;
  }
  return out;
}

interface ScopedTable {
  table: string;
  scope: string;
  loc: Loc;
}

/** Tables whose tenancy is enforced by an ORM scope rather than by the database. */
function ormScopedTables(ctx: ScanContext): Map<string, ScopedTable> {
  const scopeClasses = new Set<string>();
  const phpFiles = ctx.files.filter((f) => PHP_EXT.test(f.relPath));

  // A scope class is a tenancy scope when it filters on a tenant column.
  for (const file of phpFiles) {
    for (const [name, body] of phpClassBodies(file.content)) {
      if (!/->\s*where\w*\s*\(/.test(body)) continue;
      if (mentionsTenant(body) || TENANT_NAMED.test(name)) scopeClasses.add(name);
    }
  }

  const scoped = new Map<string, ScopedTable>();
  for (const file of phpFiles) {
    for (const [name, body] of phpClassBodies(file.content)) {
      const applied = [...body.matchAll(/addGlobalScope\s*\(\s*(?:new\s+)?([\w\\]+)/g)]
        .map((m) => m[1]!.split("\\").pop()!)
        .find((s) => scopeClasses.has(s) || TENANT_NAMED.test(s));
      const trait = /\buse\s+([\w\\, ]*Tenant\w*)\s*;/i.exec(body)?.[1]?.trim();
      const scope = applied ?? trait;
      if (!scope) continue;
      // `protected $table = 'invoices';`, else Laravel's snake_case plural of the class name.
      const declared = /\$table\s*=\s*['"](\w+)['"]/.exec(body)?.[1];
      const table = normIdent(declared ?? `${name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}s`);
      const at = file.content.indexOf(`class ${name}`);
      scoped.set(table, { table, scope, loc: { file, offset: at >= 0 ? at : 0 } });
    }
  }
  return scoped;
}

interface RawAccess {
  table: string;
  loc: Loc;
  statement: string;
}

/** Raw query-builder / raw-SQL reads of a table, wherever they appear. */
function rawTableAccesses(ctx: ScanContext, tables: Set<string>): RawAccess[] {
  const out: RawAccess[] = [];
  for (const file of ctx.files) {
    if (/\.sql$/i.test(file.relPath)) continue;
    const content = file.content;
    // Laravel's query builder, and Doctrine/PDO style raw SQL in any language.
    const BUILDER = /\bDB\s*::\s*table\s*\(\s*['"]([\w.]+)['"]\s*\)|\bfrom\s*\(\s*['"]([\w.]+)['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = BUILDER.exec(content)) !== null) {
      const table = normIdent(m[1] ?? m[2] ?? "");
      if (!tables.has(table)) continue;
      out.push({ table, loc: { file, offset: m.index }, statement: statementExtent(content, m.index) });
    }
    // A hand-written SELECT naming the table, inside a raw-execution call.
    const RAW_SQL = /\b(?:select|delete)\b[\s\S]{0,400}?\bfrom\s+["'`]?([\w.]+)["'`]?/gi;
    if (
      /\b(?:DB\s*::\s*(?:select|statement|raw|update|delete)|->\s*(?:executeQuery|executeStatement|query)\s*\(|\.raw\s*\(|find_by_sql|connection\s*\.\s*(?:execute|cursor))/i.test(
        content,
      )
    ) {
      while ((m = RAW_SQL.exec(content)) !== null) {
        const table = normIdent(m[1] ?? "");
        if (!tables.has(table)) continue;
        out.push({ table, loc: { file, offset: m.index }, statement: statementExtent(content, m.index) });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------------- finding shapes */

function surfaceOf(file: ScanFile): Surface {
  return file.surfaces[0] ?? "app_code";
}

function finding(loc: Loc, table: string, why: string, steps: string[], expected: string): DetectorFinding {
  const line = lineAtIndex(loc.file.content, loc.offset);
  return {
    tier: "verified",
    classId: "rls-gap",
    severity: "high",
    surfaces: loc.file.surfaces,
    locations: [{ path: loc.file.relPath, startLine: line, endLine: line, surface: surfaceOf(loc.file) }],
    explanation: `Table "${table}" in ${loc.file.relPath}:${line} ${why}`,
    reproduction: { kind: "inspection", steps: [`Open ${loc.file.relPath} at line ${line}.`, ...steps], expected },
  };
}

export const rlsGapDetector: Detector = {
  classIds: ["rls-gap"],
  tier: "verified",
  run(ctx: ScanContext): DetectorFinding[] {
    const findings: DetectorFinding[] = [];

    /* ---------------------------------------------------------------- relational schemas */
    for (const table of replaySql(ctx).values()) {
      // A database without row level security cannot be asked for a policy.
      if (!table.rlsCapable) continue;
      const tenantColumn = [...table.columns].find(isTenantColumn);
      // No tenant discriminator, no tenancy to enforce: a global lookup table is not a gap.
      if (!tenantColumn && !table.refTenantTable) continue;
      const scopedBy = tenantColumn ?? "a tenant foreign key";
      const anchor = table.createLoc ?? table.firstLoc;

      if (!table.rlsEnabled) {
        // Distinguish "never enabled" from "enabled once and turned off again": for the second
        // the disabling statement is the evidence a reviewer needs to see.
        const disabled = table.rlsStateLoc;
        findings.push(
          disabled
            ? finding(
                disabled,
                table.name,
                `has row level security disabled by this statement and never re-enabled, although its rows are ` +
                  `scoped by "${scopedBy}". Every tenant's rows are readable by any role that can reach the table.`,
                [
                  `Observe "alter table ${table.name} disable row level security" with no later re-enable in any migration.`,
                  `Replay the migrations in order — this is the final state of the table.`,
                ],
                `Table "${table.name}" ends the migration sequence with RLS off, so cross-tenant reads are possible.`,
              )
            : finding(
                anchor,
                table.name,
                `is scoped by "${scopedBy}" but row level security is never enabled on it. ` +
                  `Any authenticated role can read every tenant's rows.`,
                [
                  `Search every .sql file for "alter table ${table.name} enable row level security" — it is not present.`,
                ],
                `Table "${table.name}" has no RLS, so cross-tenant reads are possible.`,
              ),
        );
        continue;
      }

      if (table.policies.size === 0) {
        findings.push(
          finding(
            table.rlsStateLoc ?? anchor,
            table.name,
            `has row level security enabled but no policy is ever attached to it, in this or any other migration. ` +
              `The table owner and any role that bypasses RLS still read every tenant's rows, and no rule expresses ` +
              `the intended isolation on "${scopedBy}".`,
            [
              `Search every .sql file for "create policy ... on ${table.name}" — none exists.`,
              `Note the enable statement without a matching policy.`,
            ],
            `Table "${table.name}" has RLS enabled but no policy defining tenant isolation.`,
          ),
        );
        continue;
      }

      const wideOpen = [...table.policies.values()].find(
        (p) => p.permissive && READ_COMMANDS.has(p.command) && isConstantTrue(p.using),
      );
      if (wideOpen) {
        findings.push(
          finding(
            wideOpen.loc,
            table.name,
            `has a permissive ${p_cmd(wideOpen.command)} policy "${wideOpen.name}" whose predicate reduces to a ` +
              `constant, so it filters nothing. The table is scoped by "${scopedBy}", but every tenant reads every ` +
              `other tenant's rows.`,
            [
              `Observe the policy predicate — "using (${(wideOpen.using ?? "true").trim()})" admits every row.`,
              `Confirm no restrictive policy narrows it back down.`,
            ],
            `Table "${table.name}" is readable across tenants despite RLS being enabled.`,
          ),
        );
      }
    }

    /* --------------------------------------- ORM tenancy scope bypassed by the raw builder */
    const scoped = ormScopedTables(ctx);
    if (scoped.size > 0) {
      const seen = new Set<string>();
      for (const access of rawTableAccesses(ctx, new Set(scoped.keys()))) {
        if (mentionsTenant(access.statement)) continue; // this path scopes itself
        const model = scoped.get(access.table)!;
        const key = `${access.loc.file.relPath}:${access.loc.offset}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(
          finding(
            access.loc,
            access.table,
            `is tenant-scoped only by the ORM scope "${model.scope}" declared in ` +
              `${model.loc.file.relPath}, and this query reaches the same table through the raw query ` +
              `builder, which never applies that scope. The statement carries no tenant predicate of ` +
              `its own, so it returns every tenant's rows.`,
            [
              `Observe the query building on the raw builder rather than the "${access.table}" model.`,
              `Confirm the tenancy filter lives in "${model.scope}" (${model.loc.file.relPath}), which only runs for ORM queries.`,
              `Note that this statement adds no tenant_id condition of its own.`,
            ],
            `The raw-builder query over "${access.table}" is not tenant-scoped, so cross-tenant rows are returned.`,
          ),
        );
      }
    }

    /* ----------------------------------------------------------------- document databases */
    for (const file of ctx.files) {
      if (!RULES_FILE.test(file.relPath)) continue;
      const tenantAware = new RegExp(`\\b${TENANT_STEM}s?\\b`, "i").test(file.content);
      for (const allow of collectRuleAllows(file.content)) {
        if (!allow.ops.some((o) => o === "read" || o === "get" || o === "list")) continue;
        if (!isUnconditional(allow.condition)) continue;
        const segments = normalizeRulePath(allow.path);
        const recursiveRoot = segments.length <= 1 && /\{[^}]*=\*\*\}/.test(allow.path);
        if (!isTenantScopedPath(allow.path) && !(recursiveRoot && tenantAware)) continue;
        const collection = segments.find((s) => !s.startsWith("{")) ?? segments[0] ?? "documents";
        findings.push(
          finding(
            { file, offset: allow.offset },
            collection,
            `is exposed by a rule on "${allow.path}" that allows read with no condition ` +
              `(${allow.condition ? `if ${allow.condition}` : "no if clause"}). The path is scoped per tenant, so ` +
              `any caller can read every tenant's documents.`,
            [
              `Observe the "allow ${allow.ops.join(", ")}" rule on a per-tenant path with an unconditional predicate.`,
              `Note that no request.auth or ownership check narrows the read.`,
            ],
            `Documents under "${allow.path}" are readable across tenants.`,
          ),
        );
      }
    }

    return findings;
  },
};

function p_cmd(command: string): string {
  return command === "all" ? "all-command" : command;
}
