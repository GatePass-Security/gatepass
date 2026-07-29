import type { Detector, DetectorFinding, ScanContext, ScanFile } from "@gatepass/engine";
import type { Severity } from "@gatepass/findings";
import { lineAtIndex } from "@gatepass/engine";

/**
 * Verified detector: a cross-origin policy that grants read access to an origin the
 * attacker controls, on a resource that is not already public.
 *
 * The detector is written around that sentence rather than around any one framework, so it
 * has three independent parts:
 *
 *  1. WHERE the policy is expressed. Either a literal `Access-Control-Allow-Origin`
 *     response header (Express/Next/Go/Python handlers, nginx `add_header`, YAML/JSON
 *     config) or a CORS middleware option (`origin`, `allow_origins`, `AllowedOrigins`,
 *     `CORS_ALLOW_ALL_ORIGINS`, …). Both are collected as "origin grants".
 *
 *  2. WHETHER the granted origin is permissive. Four shapes qualify, and each is a
 *     different real-world bug:
 *       - wildcard: a literal `*`, or an identifier that constant-folds to `*` (the
 *         "defaultOrigin fallback" bug, where the wildcard is never written at the header);
 *       - reflection: the value is the request's own Origin header echoed back
 *         (`$http_origin`, `req.headers.origin`, `origin: true`, Go's
 *         `w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))`) — an
 *         allow-list of one, chosen by the attacker;
 *       - permissive predicate: the origin is admitted by a suffix/prefix/substring test
 *         (`origin.endsWith("acme.com")` also admits `evilacme.com`, Envoy's
 *         `suffix: "example.com"` admits `evil-example.com` and `prefix:` admits
 *         `example.com.attacker.net`) or an unanchored regex, rather than by exact
 *         comparison against an allow-list;
 *       - allow-all flags (`AllowAllOrigins: true`, `allow_origin_regex=".*"`).
 *
 *  3. WHETHER it matters. `Access-Control-Allow-Origin: *` without credentials grants an
 *     attacker page nothing it could not fetch from its own server, which is why a public
 *     CDN or status feed legitimately ships one. So credentials — explicit, or implied by
 *     the surrounding code handling cookies/sessions/Authorization — drive severity, and
 *     an explicitly credential-free public/static context clears the finding entirely.
 *
 * Evidence is scoped to the nearest enclosing block (the nginx `location`, the middleware
 * options object, the handler body, the gateway route's YAML subtree), not to the whole file:
 * a config that is permissive for static assets and strict for the API must not be judged by
 * its strictest neighbour.
 *
 * Step 2 deliberately does NOT assume the permissive value is written where the policy is.
 * The same constant-folding that follows a JS `const defaultOrigin = "*"` across modules also
 * follows a Spring property placeholder: `@Value("${cors.allowed-origins:*}")` is a wildcard
 * whenever nothing in the bundled `application.yml`/`application.properties` sets that key,
 * because `:*` is the value Spring binds when the property is absent.
 */

type Permissiveness = "wildcard" | "reflected" | "predicate" | "allow-all";

interface Span {
  start: number;
  end: number;
}

interface OriginGrant {
  index: number;
  kind: Permissiveness;
  detail: string;
}

/* ── file selection ─────────────────────────────────────────────────────────────────── */

/**
 * CORS is decided in application code AND at the reverse proxy / gateway config, so the
 * filter has to cover both. `.conf` in particular was excluded before, which made every
 * nginx policy invisible.
 */
const CORS_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|php|java|kt|cs|json|ya?ml|toml|conf|cfg|ini|tf|properties)$/i;
const CORS_FILE_BASENAMES = new Set(["nginx.conf", "dockerfile", "caddyfile", "httpd.conf", ".htaccess"]);

/**
 * A file only matters here if it says something about cross-origin policy at all. The
 * token is matched with a prefix rather than a word boundary because the settings-style
 * spellings (`CORS_ALLOW_ALL_ORIGINS`, `corsheaders`) glue it to the next word.
 *
 * `allow[-_]origin` (rather than `allow_origins`) is what admits the gateway spellings —
 * Envoy's `allow_origin_string_match`, an ingress annotation's `cors-allow-origin` — and
 * `allowedorigin`/`crossorigin` admit Spring's `allowedOriginPatterns(...)` and
 * `@CrossOrigin`, none of which contain the substring the previous pattern required.
 *
 * The final alternative is the framework *entry point* rather than the token: ASP.NET Core
 * turns CORS on with `AddCors(...)`/`UseCors(...)`, and in PascalCase there is no word
 * boundary before `Cors`, so `\bcors` never sees it. A file whose entire CORS policy is
 * registered through those calls was therefore not considered a CORS file at all.
 */
const CORS_CONTEXT =
  /access-control-allow-origin|\bcors[\w-]*|allow[-_]origin|allowedorigin|cross[-_]?origin|\b(?:add|use|enable|with|configure)[_-]?cors\b/i;

function isConfigSurface(relPath: string): boolean {
  return /\.(conf|cfg|ini|tf|ya?ml|toml)$/i.test(relPath) || /(^|\/)(nginx\.conf|caddyfile|\.htaccess)$/i.test(relPath);
}

function isHashComment(relPath: string): boolean {
  return !/\.(ts|tsx|js|jsx|mjs|cjs|json|go|java|php|tf)$/i.test(relPath);
}

/* ── lexical scaffolding ────────────────────────────────────────────────────────────── */

/**
 * Bracket spans with string and comment bodies skipped. Used to scope evidence to the
 * nearest enclosing block instead of a fixed character window, which is what lets an nginx
 * `location` be judged on its own contents.
 */
function bracketSpans(content: string, hashComments: boolean): Span[] {
  const spans: Span[] = [];
  const stack: number[] = [];
  let i = 0;
  let str: string | null = null;
  let line = false;
  let block = false;

  while (i < content.length) {
    const c = content[i]!;
    const n = content[i + 1];
    if (line) {
      if (c === "\n") line = false;
      i++;
      continue;
    }
    if (block) {
      if (c === "*" && n === "/") {
        block = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (str) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === str || c === "\n") str = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      line = true;
      i += 2;
      continue;
    }
    if (c === "/" && n === "*") {
      block = true;
      i += 2;
      continue;
    }
    if (hashComments && c === "#") {
      line = true;
      i++;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") {
      stack.push(i);
      i++;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      const s = stack.pop();
      if (s !== undefined) spans.push({ start: s, end: i });
      i++;
      continue;
    }
    i++;
  }
  return spans;
}

/** Nearest enclosing block that is big enough to hold sibling options but still local. */
function scopeAt(content: string, spans: Span[], index: number): string {
  const enclosing = spans
    .filter((s) => s.start < index && index < s.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start));
  for (const s of enclosing) {
    const text = content.slice(s.start, s.end + 1);
    const lines = text.split("\n").length;
    if (lines >= 2 && lines <= 120) return stripComments(text);
  }
  const line = lineAtIndex(content, index);
  const all = content.split(/\r?\n/);
  return stripComments(all.slice(Math.max(0, line - 9), line + 8).join("\n"));
}

/**
 * Nearest enclosing block in a bracket-free structured config. A gateway declares one CORS
 * policy per route as a nested map, and `scopeAt` can only fall back to a fixed line window
 * there — which reads a neighbouring route's `allow_credentials` as if it were this route's.
 * Walks up to the closest ancestor key whose subtree is large enough to hold the policy's
 * sibling options.
 */
function yamlScopeAt(content: string, index: number): string {
  const lines = content.split(/\r?\n/);
  const indentOf = (l: string) => (l.trim() === "" ? Number.MAX_SAFE_INTEGER : l.length - l.trimStart().length);
  let anchor = lineAtIndex(content, index) - 1;
  let best = "";

  for (let climb = 0; climb < 4; climb++) {
    const anchorIndent = indentOf(lines[anchor] ?? "");
    let parent = -1;
    for (let i = anchor - 1; i >= 0; i--) {
      if (indentOf(lines[i]!) < anchorIndent) {
        parent = i;
        break;
      }
    }
    if (parent < 0) break;
    const parentIndent = indentOf(lines[parent]!);
    let end = parent;
    for (let i = parent + 1; i < lines.length; i++) {
      if (lines[i]!.trim() === "") continue;
      if (indentOf(lines[i]!) <= parentIndent) break;
      end = i;
    }
    if (end - parent + 1 > 160) break;
    best = lines.slice(parent, end + 1).join("\n");
    if (end - parent + 1 >= 3) break;
    anchor = parent;
  }

  const line = lineAtIndex(content, index);
  return stripComments(best || lines.slice(Math.max(0, line - 7), line + 6).join("\n"));
}

/** A wildcard inside an assertion is a test *about* the policy, not the policy. */
const ASSERTION_LINE =
  /\bexpect\s*\(|\bassert\w*\s*[(.]|\.\s*(?:toBe|toEqual|toMatch|toHaveBeenCalledWith)\s*\(|\bshould\s*\.|\bt\.(?:is|deepEqual)\s*\(/;

/**
 * The name argument of a test declaration — `it("…")`, `describe("…")`, `t.Run("…")`. Its
 * contents are a sentence describing the behaviour under test, so a header name or an origin
 * value quoted inside it is prose, not a policy: `it("never pairs Access-Control-Allow-Origin:
 * * with credentials")` is the *negation* of the policy it appears to declare, and reading it
 * as a declaration turns a passing regression test into a finding against the very code it
 * protects.
 *
 * `ASSERTION_LINE` already covers the body of such a test, but the title is a separate
 * position: it is one string, it can be far from any `expect(`, and it is the one place in a
 * codebase where security-relevant strings are deliberately written out in full.
 *
 * The lookbehind rejects a dotted receiver, so a real `pattern.test("…")` call — where the
 * string is data being matched, not a test name — is untouched.
 */
const TEST_TITLE =
  /(?<![\w$.])(?:t\s*\.\s*Run|[xf]?(?:describe|context|specify|suite|scenario|feature|it|test)(?:\s*\.\s*[A-Za-z_$]\w*)*)\s*\(\s*(["'`])/g;

/** Character spans covered by test-declaration titles. */
function testTitleSpans(content: string): Span[] {
  const spans: Span[] = [];
  TEST_TITLE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEST_TITLE.exec(content)) !== null) {
    const quote = m[1]!;
    const open = m.index + m[0].length - 1;
    let i = open + 1;
    while (i < content.length) {
      const c = content[i]!;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote || (c === "\n" && quote !== "`")) break;
      i++;
    }
    spans.push({ start: open, end: Math.min(i, content.length - 1) });
    TEST_TITLE.lastIndex = Math.max(TEST_TITLE.lastIndex, i);
  }
  return spans;
}

function inSpan(spans: Span[], index: number): boolean {
  return spans.some((s) => index >= s.start && index <= s.end);
}

/** Prose about CORS is not a CORS policy — drop comment lines before judging evidence. */
function stripComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => {
      const t = l.trimStart();
      return t.startsWith("//") || t.startsWith("#") || t.startsWith("*") || t.startsWith("/*") ? "" : l;
    })
    .join("\n");
}

function isCommentLine(text: string): boolean {
  const t = text.trim();
  return t.startsWith("//") || t.startsWith("#") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("--");
}

/* ── credentials and public-resource context ────────────────────────────────────────── */

/**
 * `(?:[:=]|\(\s*)` rather than `[:=]`: the builder dialects say it with a call, not an
 * assignment — Spring's `.allowCredentials(true)` and `CorsConfiguration.setAllowCredentials(true)`
 * are the same declaration as `credentials: true`, and reading them as "unknown" downgraded
 * every Spring finding from high to medium.
 *
 * The last alternative is the *nullary* builder call. A fluent CORS policy builder that takes
 * no argument carries its verb in the method name — ASP.NET Core's `AllowCredentials()` /
 * `DisallowCredentials()`, and the same shape in other builder APIs — so the call itself is
 * the declaration. Requiring a literal `true` there reads an explicitly credentialed policy
 * as "credentials unknown", which is how a credentialed origin check gets scored as if the
 * responses were anonymous.
 */
const CREDS_ON =
  /access-control-allow-credentials["'`\]\s:=,()]*["']?true|(?:allow[_-]?credentials|\bcredentials|withcredentials|allowcredentials|supports_credentials)\s*(?:[:=]|\(\s*)\s*["']?(?:true)["']?|\b(?:allow|with|support|supports|enable|set)[_-]?credentials\s*\(\s*\)/i;
const CREDS_OFF =
  /access-control-allow-credentials["'`\]\s:=,()]*["']?false|(?:allow[_-]?credentials|\bcredentials|withcredentials|allowcredentials|supports_credentials)\s*(?:[:=]|\(\s*)\s*["']?(?:false|none|null)["']?|\b(?:disallow|deny|without|disable|no)[_-]?credentials\s*\(\s*\)/i;

/** Cookies, sessions or bearer tokens in the same block mean responses are not anonymous. */
const AUTH_TRAFFIC =
  /\bcookies?\b|set-cookie|\bsessions?\b|\bauthorization\b|\bbearer\b|\bjwt\b|auth[_-]?token|req\.user\b|current_user|\blogin\b|\bsigned[_-]?in\b/i;

/** Immutable public asset delivery — the one place a wildcard origin is the intended design. */
const PUBLIC_RESOURCE =
  /\btry_files\b|\balias\s|\broot\s+\/|express\.static|serve[_-]?static|send_?file|\bimmutable\b|max-age=\d{5,}|\.(?:woff2?|ttf|otf|eot|css|svg|png|jpe?g|gif|ico|webp|avif|mp4|map)\b|\bpublic\b/i;

type CredentialState = "on" | "off" | "unknown";

function credentialState(scope: string, file: string, allowFileFallback: boolean): CredentialState {
  if (CREDS_OFF.test(scope)) return "off";
  if (CREDS_ON.test(scope)) return "on";
  if (!allowFileFallback) return "unknown";
  const stripped = stripComments(file);
  if (CREDS_OFF.test(stripped)) return "off";
  if (CREDS_ON.test(stripped)) return "on";
  return "unknown";
}

/* ── value classification ───────────────────────────────────────────────────────────── */

const REQUEST_ORIGIN =
  /headers?\s*\.\s*get\s*\(\s*["'`]origin|headers?\s*\[\s*["'`]origin|headers?\s*\.\s*origin\b|Header\s*\.\s*Get\s*\(\s*["'`]Origin|request\.origin\b|\$http_origin|HTTP_ORIGIN|getHeader\s*\(\s*["'`]origin/i;

/** Strip one layer of quoting/array wrapping from a captured value token. */
function unwrap(raw: string): string {
  let v = raw.trim();
  v = v.replace(/^[[(]\s*/, "").replace(/\s*[)\]]$/, "");
  const q = v[0];
  if (q === '"' || q === "'" || q === "`") {
    const end = v.indexOf(q, 1);
    v = end > 0 ? v.slice(1, end) : v.slice(1);
  }
  return v.trim();
}

/**
 * Bounded constant folding across the scanned tree: an identifier is followed through
 * `const x = y`, `x := y`, `x: y` and single-expression function returns, up to a few hops.
 * This is what catches a wildcard that only ever appears as `const defaultOrigin = "*"`
 * three call frames away from the header it ends up in.
 */
function resolveLiterals(token: string, files: ScanFile[], depth = 0, seen = new Set<string>()): string[] {
  if (depth > 3 || seen.has(token) || !/^[A-Za-z_$][\w$.]*$/.test(token)) return [];
  seen.add(token);
  const name = token.split(".").pop()!;
  const out: string[] = [];

  const assign = new RegExp(
    `(?:^|[\\s;{(,])(?:const|let|var|final|static)?\\s*${escapeRe(name)}\\s*(?::=|=(?!=)|:)\\s*([^\\n;,)]+)`,
    "g",
  );
  const fnReturn = new RegExp(
    `func\\s+${escapeRe(name)}\\s*\\([^)]*\\)[^{]*\\{|function\\s+${escapeRe(name)}\\s*\\(`,
    "g",
  );

  for (const f of files) {
    const body = stripComments(f.content);

    assign.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = assign.exec(body)) !== null) {
      const rhs = (m[1] ?? "").trim();
      if (/^["'`]/.test(rhs)) out.push(unwrap(rhs));
      else if (/^[A-Za-z_$][\w$]*$/.test(rhs)) out.push(...resolveLiterals(rhs, files, depth + 1, seen));
      else if (/^[A-Za-z_$][\w$]*\(\s*\)$/.test(rhs))
        out.push(...resolveLiterals(rhs.replace(/\(\s*\)$/, ""), files, depth + 1, seen));
      if (out.length > 8) return out;
    }

    // A zero-argument accessor: every `return X` in its body is a candidate value.
    fnReturn.lastIndex = 0;
    if (fnReturn.exec(body)) {
      const start = fnReturn.lastIndex;
      const slice = body.slice(start, start + 1200);
      const stop = slice.indexOf("\nfunc ");
      const bodyText = stop > 0 ? slice.slice(0, stop) : slice;
      for (const r of bodyText.matchAll(/\breturn\s+([^\n;]+)/g)) {
        const rhs = (r[1] ?? "").trim();
        if (/^["'`]/.test(rhs)) out.push(unwrap(rhs));
        else if (/^[A-Za-z_$][\w$]*$/.test(rhs)) out.push(...resolveLiterals(rhs, files, depth + 1, seen));
        if (out.length > 8) return out;
      }
    }
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ── Spring property placeholders: constant folding through the config files ────────── */

/**
 * `@Value("${app.cors.allowed-origins:*}")` is the same class of problem as `const
 * defaultOrigin = "*"` in another module — the wildcard is never written next to the policy —
 * so it is resolved by the same mechanism rather than special-cased. The one extra step is
 * that the "definition" lives in a config file: the text after `:` is the value Spring binds
 * *only when the property is absent*, so the bundled `application.yml` /
 * `application.properties` decides which of the two values is the real one.
 */
interface FoldEnv {
  files: ScanFile[];
  /** Flattened, relaxed-binding-normalised Spring properties from every bundled config file. */
  springProps: Map<string, string[]>;
  /** nginx `map` variables, by lower-cased `$name`. See `collectNginxMaps`. */
  nginxMaps: Map<string, NginxMap>;
}

const SPRING_CONFIG_FILE = /(?:^|\/)(?:application|bootstrap)(?:-[\w.]+)?\.(?:ya?ml|properties)$/i;
const JVM_FILE = /\.(?:java|kt|kts|groovy)$/i;
/** Deployment manifests where the same property is supplied as an environment variable. */
const ENV_SOURCE_FILE =
  /(?:^|\/)\.env|(?:^|\/)(?:docker-)?compose[\w.-]*\.ya?ml$|(?:^|\/)[\w.-]*(?:deployment|values|env)[\w.-]*\.ya?ml$/i;

/** Spring's relaxed binding treats `allowed-origins`, `allowed_origins` and `allowedOrigins` alike. */
function normPropKey(key: string): string {
  return key.replace(/[-_]/g, "").toLowerCase();
}

/** Relaxed binding also lets `APP_CORS_ALLOWED_ORIGINS` supply `app.cors.allowed-origins`. */
function flatPropKey(key: string): string {
  return key.replace(/[-_.]/g, "").toLowerCase();
}

function lookupProp(key: string, props: Map<string, string[]>): string[] | undefined {
  return props.get(normPropKey(key)) ?? props.get(flatPropKey(key));
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((v) => unwrap(v))
    .filter((v) => v.length > 0);
}

function collectSpringProps(files: ScanFile[]): Map<string, string[]> {
  const props = new Map<string, string[]>();

  const add = (path: string, values: string[]) => {
    if (!path || values.length === 0) return;
    for (const k of new Set([normPropKey(path), flatPropKey(path)])) {
      props.set(k, [...(props.get(k) ?? []), ...values]);
    }
  };

  /* A property supplied as an environment variable is just as set as one written in
     application.yml, and deployment manifests are where that spelling lives. */
  for (const file of files) {
    if (!ENV_SOURCE_FILE.test(file.relPath)) continue;
    for (const m of file.content.matchAll(/(?:^|[\s"'-])([A-Z][A-Z0-9_]{4,})\s*[:=]\s*([^\n#]{0,200})/g)) {
      add(m[1]!, splitCsv(m[2]!.trim()));
    }
    // Kubernetes splits the pair across two keys: `- name: FOO` then `value: bar`.
    for (const m of file.content.matchAll(
      /name\s*:\s*["']?([A-Z][A-Z0-9_]{4,})["']?\s*\r?\n\s*value\s*:\s*([^\n#]{0,200})/g,
    )) {
      add(m[1]!, splitCsv(m[2]!.trim()));
    }
  }

  for (const file of files) {
    if (!SPRING_CONFIG_FILE.test(file.relPath)) continue;

    if (/\.properties$/i.test(file.relPath)) {
      for (const raw of file.content.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#") || line.startsWith("!")) continue;
        const sep = line.search(/[=:]/);
        if (sep <= 0) continue;
        add(line.slice(0, sep).trim(), splitCsv(line.slice(sep + 1).trim()));
      }
      continue;
    }

    // YAML: an indentation stack turns nesting back into the dotted key Spring binds.
    const stack: { indent: number; key: string }[] = [];
    let listPath = "";
    for (const raw of file.content.split(/\r?\n/)) {
      const line = raw.replace(/\s+#.*$/, "");
      if (!line.trim() || /^\s*#/.test(line) || /^\s*(?:---|\.\.\.)\s*$/.test(line)) continue;
      const indent = line.length - line.trimStart().length;
      const text = line.trim();
      if (text.startsWith("- ")) {
        if (listPath) add(listPath, splitCsv(text.slice(2).trim()));
        continue;
      }
      listPath = "";
      const colon = text.indexOf(":");
      if (colon < 0) continue;
      while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
      const key = unwrap(text.slice(0, colon).trim());
      const value = text.slice(colon + 1).trim();
      const path = [...stack.map((s) => s.key), key].join(".");
      if (value) add(path, splitCsv(value));
      else {
        stack.push({ indent, key });
        listPath = path;
      }
    }
  }
  return props;
}

/* ── nginx map variables: constant folding through the proxy's own lookup table ─────── */

/**
 * An nginx `map` block is nginx's spelling of an allow-list, and it is the reason a reverse
 * proxy can echo an origin safely. `add_header Access-Control-Allow-Origin $api_allow_origin`
 * says nothing on its own; the `map` that defines `$api_allow_origin` says everything. Without
 * resolving it the detector sees an unresolvable variable whose name contains "origin" and
 * falls back to "assume reflection" — which is right for a map that echoes by default and
 * wrong for one that matches exact origins.
 *
 * The distinction is a property of the map, not of any file:
 *
 *   map $http_origin $v { default $http_origin; "" ""; }        ← every origin matches the
 *       default and is echoed. Unbounded; the listed keys change nothing.
 *
 *   map $http_origin $v { default ""; "https://app.example.com" $http_origin; }
 *       ← the default emits nothing, and the only keys that produce a value are complete
 *         quoted origins compared as whole strings. Bounded by an author-written list.
 *
 * So a map is an exact allow-list iff (a) its `default` does not emit a variable — a variable
 * default is evaluated for every unmatched origin, which is the whole input space — and
 * (b) every key is a literal, with no `~` regular expression, no `*` hostname wildcard and no
 * `hostnames`/`include` directive, each of which widens matching beyond the strings written.
 * Values may freely echo the source variable: echoing an origin you have already matched
 * exactly is the correct implementation of a credentialed allow-list, not a defect.
 */
interface NginxMap {
  source: string;
  exactAllowlist: boolean;
  reason: string;
}

const NGINX_MAP_HEAD = /(?:^|\n)[ \t]*map[ \t]+(\$[A-Za-z_]\w*)[ \t]+(\$[A-Za-z_]\w*)[ \t]*\{/g;

function collectNginxMaps(files: ScanFile[]): Map<string, NginxMap> {
  const maps = new Map<string, NginxMap>();
  for (const file of files) {
    if (!/\.(conf|cfg)$/i.test(file.relPath) && !/(^|\/)nginx\.conf$/i.test(file.relPath)) continue;
    const body = file.content;
    NGINX_MAP_HEAD.lastIndex = 0;
    let head: RegExpExecArray | null;
    while ((head = NGINX_MAP_HEAD.exec(body)) !== null) {
      const open = body.indexOf("{", head.index);
      const close = matchBracket(body, open);
      if (close < 0) continue;
      NGINX_MAP_HEAD.lastIndex = close;

      const source = head[1]!;
      const target = head[2]!;
      let exact = true;
      let reason = "every key is a complete literal origin and the default emits nothing";

      for (const raw of body.slice(open + 1, close).split(/\r?\n/)) {
        const line = raw.trim().replace(/;\s*$/, "");
        if (line === "" || line.startsWith("#")) continue;
        const sep = /\s/.exec(line);
        const key = (sep ? line.slice(0, sep.index) : line).trim();
        const value = sep ? line.slice(sep.index).trim() : "";

        if (/^(hostnames|volatile|include)$/i.test(key) || /^include$/i.test(key)) {
          exact = false;
          reason = `\`${key}\` widens matching beyond the keys written here`;
          break;
        }
        if (key.toLowerCase() === "default") {
          if (value.startsWith("$")) {
            exact = false;
            reason = `its \`default\` emits \`${value}\`, so every unlisted origin is echoed`;
            break;
          }
          continue;
        }
        if (key.startsWith("~") || key.includes("*")) {
          exact = false;
          reason = `the key \`${key}\` matches a family of origins rather than one`;
          break;
        }
      }
      maps.set(target.toLowerCase(), { source, exactAllowlist: exact, reason });
    }
  }
  return maps;
}

/** Is `index` inside an unclosed `${…}` expression? */
function insidePlaceholder(body: string, index: number): boolean {
  const window = body.slice(Math.max(0, index - 160), index);
  const open = window.lastIndexOf("${");
  return open >= 0 && !window.slice(open).includes("}");
}

/** The `:` that separates a placeholder's key from its default, ignoring nested `${…}`. */
function placeholderSplit(body: string): number {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "$" && body[i + 1] === "{") {
      depth++;
      i++;
      continue;
    }
    if (body[i] === "}") {
      depth--;
      continue;
    }
    if (body[i] === ":" && depth === 0) return i;
  }
  return -1;
}

/**
 * Values a `@Value`/`${…}` expression can take. Empty means "cannot tell" — a placeholder with
 * no default whose property is not in the scan is not evidence of anything.
 */
function resolvePlaceholder(expr: string, env: FoldEnv, depth = 0): string[] {
  const trimmed = expr.trim();
  const m = /^\$\{([\s\S]*)\}$/.exec(trimmed);
  if (!m) return trimmed ? splitCsv(trimmed) : [];
  if (depth > 3) return [];
  const body = m[1]!;
  const split = placeholderSplit(body);
  const key = (split >= 0 ? body.slice(0, split) : body).trim();
  const configured = lookupProp(key, env.springProps);
  if (configured && configured.length > 0) return configured;
  if (split < 0) return [];
  const fallback = body.slice(split + 1).trim();
  if (/^\$\{/.test(fallback)) return resolvePlaceholder(fallback, env, depth + 1);
  return splitCsv(fallback);
}

/**
 * The `@Value("${…}")` bound to a JVM field/parameter named `name`. The gap between the
 * annotation and the name is restricted to modifiers and a type (`[^;{}]`) so the search
 * cannot drift into the next declaration.
 */
function resolveSpringValue(name: string, env: FoldEnv): string[] | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  const re = new RegExp(`@Value\\s*\\(\\s*["']([^"']*)["']\\s*\\)[^;{}]{0,160}?\\b${escapeRe(name)}\\b`);
  for (const file of env.files) {
    if (!JVM_FILE.test(file.relPath)) continue;
    const m = re.exec(stripComments(file.content));
    if (m) return resolvePlaceholder(m[1]!, env);
  }
  return null;
}

function isWildcardLiteral(v: string): boolean {
  return v === "*" || v === ".*" || v === "^.*$" || v === "^.*" || v === ".*$";
}

/** Does this granted origin value let an attacker-chosen origin through? */
function classifyValue(raw: string, file: ScanFile, env: FoldEnv): { kind: Permissiveness; detail: string } | null {
  const v = unwrap(raw);
  if (v === "") return null;

  if (isWildcardLiteral(v) || v === "null") {
    return { kind: "wildcard", detail: `\`${v}\`` };
  }
  // `origin: true` (Express/Fastify) and `AllowAllOrigins: true` echo whatever asked.
  if (/^(true|True|1)$/.test(v)) return { kind: "reflected", detail: "reflects any request origin" };
  if (REQUEST_ORIGIN.test(raw) || REQUEST_ORIGIN.test(v)) {
    return { kind: "reflected", detail: "the request's own Origin header" };
  }
  if (/^\$\{[\s\S]*\}$/.test(v)) return classifyPlaceholder(v, env);
  if (/^https?:\/\//i.test(v) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return null; // a concrete origin
  /* `function isTrusted(origin: string)` matches the `origin:` option shape, but the token
     after the colon is a type annotation. A type is not a value and cannot be an origin. */
  if (/^(?:string|String|number|boolean|any|unknown|object|str|int|bool)$/.test(v)) return null;

  /* An nginx variable is decided by the `map` that defines it, not by its name. Resolving it
     is the same constant folding applied to a JS identifier — the lookup table just happens to
     live in the proxy config rather than in a module. */
  if (/^\$[A-Za-z_]\w*$/.test(v)) {
    const mapped = env.nginxMaps.get(v.toLowerCase());
    if (mapped) {
      return mapped.exactAllowlist
        ? null
        : { kind: "reflected", detail: `\`${v}\`, whose \`map\` block is unbounded — ${mapped.reason}` };
    }
  }

  if (/^[A-Za-z_$][\w$.]*$/.test(v)) {
    const folded = resolveLiterals(v, env.files);
    if (folded.some(isWildcardLiteral)) return { kind: "wildcard", detail: `\`${v}\` resolves to \`*\`` };
    if (folded.length > 0) return null; // resolves to concrete origins
    // Unresolvable identifier: only a finding when the file demonstrably reads the
    // request Origin header, i.e. the value can be the caller's own origin.
    if (REQUEST_ORIGIN.test(stripComments(file.content)) || /origin/i.test(v)) {
      return { kind: "reflected", detail: `\`${v}\`, derived from the request Origin header` };
    }
  }
  return null;
}

/** A `${prop:default}` expression written straight into a policy. */
function classifyPlaceholder(expr: string, env: FoldEnv): { kind: Permissiveness; detail: string } | null {
  if (!resolvePlaceholder(expr, env).some(isWildcardLiteral)) return null;
  const body = /^\$\{([\s\S]*)\}$/.exec(expr.trim())?.[1] ?? "";
  const split = placeholderSplit(body);
  const key = (split >= 0 ? body.slice(0, split) : body).trim();
  const configured = lookupProp(key, env.springProps);
  return {
    kind: "wildcard",
    detail:
      configured && configured.length > 0
        ? `\`${expr}\` — the bundled configuration sets \`${key}\` to \`*\``
        : `\`${expr}\` — nothing in the bundled configuration sets \`${key}\`, so its \`*\` default is the effective value`,
  };
}

/* ── grant collection ───────────────────────────────────────────────────────────────── */

const HEADER_NAME = /access-control-allow-origin/gi;
/**
 * A bare `origin` key is only a CORS option in a map/object literal (`cors({ origin: … })`,
 * `origin: "*"` in YAML). Accepting `=` for it would read every `const origin = …` local
 * variable as a policy declaration. Names that are unambiguously CORS options may use
 * either, because Python and settings files assign them with `=`.
 */
const ORIGIN_OPTION = /(?<![\w$.])(origins?)\s*:\s*([^\n;]{0,120})/gi;
/** `[-_]?` rather than `_?`: ingress annotations spell it `cors-allow-origin`. */
const QUALIFIED_ORIGIN_OPTION =
  /\b(allow[-_]?origins?|allowed[-_]?origins?|cors[-_]?allowed[-_]?origins?|access_control_allow_origins?)\s*(?::|=(?!=))\s*([^\n;]{0,120})/gi;
const ALLOW_ALL_FLAG =
  /\b(allow_?all_?origins?|cors_?origin_?allow_?all|cors_?allow_?all_?origins?|origin_?allow_?all)\s*(?::|=(?!=))\s*["']?(true|True|1)\b/gi;
/** The optional `-` covers the YAML block-sequence form `allow_origin_regex:\n  - ".*"`. */
const ORIGIN_REGEX_OPTION = /\ballow_?origin_?regex\s*(?::|=(?!=))\s*(?:\s*-\s*)?r?["'`]([^"'`]*)["'`]/gi;

/* ── gateway policy blocks (Envoy and friends) ──────────────────────────────────────── */

/**
 * A gateway expresses CORS as structured config rather than as a header write, so there is no
 * `*` anywhere in the shape and the bug lives entirely in the match semantics:
 * `suffix: "example.com"` admits `evil-example.com`, `prefix: "https://example.com"` admits
 * `https://example.com.attacker.net`, and an unanchored `safe_regex` admits both. `exact` is
 * the only matcher that names an origin instead of describing a family of them.
 */
const ORIGIN_MATCH_LIST = /\ballow[-_]?origin[-_]?string[-_]?match\s*["']?\s*:/gi;
const ORIGIN_MATCHER = /(?:^|[\s,{[-])["']?(exact|prefix|suffix|contains|safe_?regex|regex)["']?\s*:/gi;

/** Index of the bracket closing the one at `openIdx`, skipping string bodies. */
function matchBracket(content: string, openIdx: number): number {
  const open = content[openIdx];
  if (open !== "{" && open !== "[" && open !== "(") return -1;
  let depth = 0;
  let quote = "";
  for (let i = openIdx; i < content.length; i++) {
    const c = content[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/** The indented subtree owned by the key at `keyIndex` (YAML block style). */
function indentedChildBlock(content: string, keyIndex: number): { text: string; start: number } {
  const lineStart = content.lastIndexOf("\n", keyIndex) + 1;
  const keyIndent = /^[ \t]*/.exec(content.slice(lineStart, keyIndex + 1))![0].length;
  const firstNewline = content.indexOf("\n", keyIndex);
  if (firstNewline < 0) return { text: "", start: content.length };
  const start = firstNewline + 1;
  let cursor = start;
  let end = start;
  while (cursor < content.length) {
    let nl = content.indexOf("\n", cursor);
    if (nl < 0) nl = content.length;
    const line = content.slice(cursor, nl);
    if (line.trim() !== "" && /^[ \t]*/.exec(line)![0].length <= keyIndent) break;
    end = nl;
    cursor = nl + 1;
  }
  return { text: content.slice(start, end), start };
}

/** The value block of a structured key, whichever of block or flow style the author used. */
function structuredValueBlock(content: string, keyEnd: number, keyIndex: number): { text: string; start: number } {
  const flow = /^[\s\r\n]*[[{]/.exec(content.slice(keyEnd, keyEnd + 80));
  if (flow) {
    const open = keyEnd + flow[0].length - 1;
    const close = matchBracket(content, open);
    if (close > open) return { text: content.slice(open, close + 1), start: open };
  }
  return indentedChildBlock(content, keyIndex);
}

/* ── Spring / JVM CORS builders ─────────────────────────────────────────────────────── */

const JAVA_ORIGIN_CALL =
  /\.\s*(setAllowedOriginPatterns|setAllowedOrigins|allowedOriginPatterns|allowedOrigins|addAllowedOriginPattern|addAllowedOrigin)\s*\(/g;
const CROSS_ORIGIN_ANNOTATION = /@CrossOrigin\s*\(/g;
const CROSS_ORIGIN_ATTR = /^(origins?|originPatterns?|value)$/i;

function splitTopLevelArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Flatten the collection literals Spring accepts down to the individual origin expressions. */
function javaOriginValues(arg: string, depth = 0): string[] {
  const t = arg.trim();
  if (depth > 3) return [t];
  const coll =
    /^(?:java\.util\.)?(?:List\.of|Set\.of|Arrays\.asList|Collections\.singletonList|ImmutableList\.of|Stream\.of|listOf|setOf)\s*\(([\s\S]*)\)$/.exec(
      t,
    );
  if (coll) return splitTopLevelArgs(coll[1]!).flatMap((a) => javaOriginValues(a, depth + 1));
  const array = /^new\s+String\s*\[\s*\]\s*\{([\s\S]*)\}$/.exec(t);
  if (array) return splitTopLevelArgs(array[1]!).flatMap((a) => javaOriginValues(a, depth + 1));
  const split = /^["']([^"']*)["']\s*\.\s*split\s*\(/.exec(t);
  if (split) return splitCsv(split[1]!);
  return [t];
}

/**
 * Classify one origin expression from a JVM CORS builder. Deliberately narrower than
 * `classifyValue`: a Spring config never reads the request's Origin header itself, so an
 * identifier that merely *contains* "origin" is a field name, not evidence of reflection.
 * The value is only permissive if it is literally `*`, or if it folds to `*` through a
 * property placeholder or an in-repo constant.
 */
function classifyJavaOrigin(expr: string, env: FoldEnv): { kind: Permissiveness; detail: string } | null {
  const v = unwrap(expr);
  if (v === "") return null;
  if (isWildcardLiteral(v)) return { kind: "wildcard", detail: `\`${v}\`` };
  if (/^\$\{[\s\S]*\}$/.test(v)) return classifyPlaceholder(v, env);
  if (/^https?:\/\//i.test(v) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return null;
  if (!/^[A-Za-z_$][\w$.]*$/.test(v)) return null;

  const spring = resolveSpringValue(v.split(".").pop()!, env);
  if (spring !== null) {
    if (spring.some(isWildcardLiteral)) {
      return { kind: "wildcard", detail: `\`${v}\` resolves to \`*\`` };
    }
    return null;
  }
  const folded = resolveLiterals(v, env.files);
  if (folded.some(isWildcardLiteral)) return { kind: "wildcard", detail: `\`${v}\` resolves to \`*\`` };
  return null;
}

/** Value token that follows a header name or option key, tolerating `", "`, `"] = `, `: `. */
function valueAfter(content: string, from: number): string {
  let rest = content.slice(from, from + 200).replace(/\r?\n/g, " ");
  rest = rest.replace(/^["'`\]]*/, "");
  rest = rest.replace(/^\s*/, "");
  rest = rest.replace(/^[,:=]\s*/, "");
  rest = rest.replace(/^[-[(]\s*/, "");
  rest = rest.replace(/^\s*/, "");
  const q = rest[0];
  if (q === '"' || q === "'" || q === "`") {
    const end = rest.indexOf(q, 1);
    return end > 0 ? rest.slice(0, end + 1) : rest.slice(0, 40);
  }
  return (rest.match(/^[^\s,;)\]}]+/) ?? [""])[0]!;
}

/**
 * Suffix/prefix/substring tests against the request origin. `origin.endsWith("acme.com")`
 * is satisfied by `evilacme.com`, and `startsWith`/`includes` are worse; only exact
 * comparison (or membership in an allow-list, where the origin is the *argument*) is safe.
 *
 * Matched case-insensitively because the defect is the *operation*, not its spelling: the
 * same suffix test is `endsWith` in JS/TS, `EndsWith` in C#, `endsWith` in Java and
 * `endswith` in Python. A case-sensitive list encodes one language's naming convention as if
 * it were the security property, which is how a .NET `host.EndsWith(partnerSuffix)` policy
 * read as having no origin check at all. `contains` joins the list for the same reason —
 * it is C#'s and Java's spelling of the substring test JS spells `includes`.
 *
 * The receiver constraint below is what keeps this narrow: a *collection* receiver
 * (`ALLOWED_ORIGINS.Contains(origin)`) is exact membership and stays cleared, because only a
 * singular request-origin-ish receiver is accepted.
 */
const PREDICATE_JS = /\b([A-Za-z_$][\w$]*)\s*\.\s*(endsWith|startsWith|includes|contains|indexOf|search)\s*\(/gi;
const PREDICATE_PY = /\b([A-Za-z_]\w*)\s*\.\s*(endswith|startswith|find)\s*\(/g;
const PREDICATE_GO = /strings\s*\.\s*(HasSuffix|HasPrefix|Contains)\s*\(\s*([A-Za-z_][\w.]*)/g;
const PREDICATE_REGEX = /\b([A-Za-z_$][\w$]*)\s*\.\s*(?:match|test)\s*\(\s*\/([^/\n]+)\//g;

/** Singular request-origin-ish receivers only — `ALLOWED_ORIGINS.includes(origin)` is safe. */
const ORIGIN_RECEIVER =
  /^(?:req(?:uest)?\.)?(?:headers?\.)?(?:origin|reqOrigin|requestOrigin|originHeader|originHost|host|hostname|referer|referrer|domain)$/i;

/**
 * Echoing the request Origin back is the *recommended* implementation of a strict
 * allow-list — with credentials you cannot answer `*`, so you must answer the caller's own
 * origin once you have decided you trust it. What makes reflection a vulnerability is the
 * absence of that decision. So a reflection guarded by exact membership (`SET.has(origin)`,
 * `ALLOWED.includes(origin)`, `origin === "https://…"`, `origin in ALLOWED`) is cleared —
 * while a reflection guarded by a suffix/substring test is not, because that test is
 * separately reported as a permissive predicate.
 *
 * The comparison arm requires a NON-EMPTY string literal (`["'`][^"'`\s]`, not just an
 * opening quote). Comparing the origin against `""` — `if origin != ""`, `if origin == ""`,
 * `if (!origin)` spelled the long way — decides whether the browser sent an Origin header at
 * all. That is a presence test, and every attacker-controlled origin passes it: the two sides
 * of the branch are "some origin" and "no origin", not "listed" and "unlisted". Only a
 * comparison against a concrete origin narrows the set to one the author named.
 */
const EXACT_ALLOWLIST_GATE =
  /\.\s*(?:has|includes|contains|indexOf|index_of|count)\s*\(\s*(?:req(?:uest)?\.)?(?:headers?[.[]\s*["']?)?(?:origin|reqOrigin|requestOrigin|host)\b|\b(?:origin|reqOrigin|requestOrigin|host)\s*(?:===|!==|==|!=|\.equals\s*\(|\.__eq__\s*\(?)\s*["'`][^"'`\s]|\b(?:origin|reqOrigin|requestOrigin)\s+in\s+[A-Za-z_$]|\[\s*(?:origin|reqOrigin|requestOrigin)\s*\]/i;

/**
 * The same decision spelled the way Go and Java spell it. Go has no `Array.includes`, so its
 * allow-lists are `slices.Contains(allowed, origin)`, a `map[string]bool` lookup, or a range
 * loop comparing each entry — all of them exact membership, all of them previously invisible,
 * which made every correctly-written Go allow-list look like an unguarded reflection.
 */
const MEMBERSHIP_GATE =
  /\b(?:slices\.Contains|Contains|contains|includes|IndexOf|indexOf|Index)\s*\(\s*[A-Za-z_$][\w$.]*\s*,\s*(?:req(?:uest)?\.)?(?:headers?[.[]\s*["']?)?(?:origin|reqOrigin|requestOrigin|host)\b|\b[A-Za-z_$][\w$.]*\s*(?:==|\.equals\s*\()\s*(?:origin|reqOrigin|requestOrigin|requestedOrigin)\b|\b(?:origin|reqOrigin|requestOrigin)\s*(?:==|!=)\s*[A-Za-z_$][\w$.]*\s*[{)]/;

function isAllowlistGated(scope: string, file: string): boolean {
  return (
    EXACT_ALLOWLIST_GATE.test(scope) ||
    MEMBERSHIP_GATE.test(scope) ||
    EXACT_ALLOWLIST_GATE.test(file) ||
    MEMBERSHIP_GATE.test(file)
  );
}

function collectGrants(file: ScanFile, env: FoldEnv): OriginGrant[] {
  const grants: OriginGrant[] = [];
  const body = file.content;

  const push = (index: number, cls: { kind: Permissiveness; detail: string } | null) => {
    if (cls) grants.push({ index, kind: cls.kind, detail: cls.detail });
  };

  HEADER_NAME.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADER_NAME.exec(body)) !== null) {
    push(m.index, classifyValue(valueAfter(body, m.index + m[0].length), file, env));
  }

  for (const re of [ORIGIN_OPTION, QUALIFIED_ORIGIN_OPTION]) {
    re.lastIndex = 0;
    while ((m = re.exec(body)) !== null) {
      /* `${app.cors.allowed-origins:*}` contains something that looks exactly like an option
         key followed by the value `*`, but the text after the `:` is a *default* — whether it
         is the effective value depends on the config files. The placeholder is classified as
         a whole where it is used, so reading its innards here would report the fallback of a
         property that is in fact set. */
      if (insidePlaceholder(body, m.index)) continue;
      push(m.index, classifyValue(valueAfter(body, m.index + m[1]!.length), file, env));
    }
  }

  ALLOW_ALL_FLAG.lastIndex = 0;
  while ((m = ALLOW_ALL_FLAG.exec(body)) !== null) {
    grants.push({ index: m.index, kind: "allow-all", detail: `\`${m[1]}\` is enabled` });
  }

  ORIGIN_REGEX_OPTION.lastIndex = 0;
  while ((m = ORIGIN_REGEX_OPTION.exec(body)) !== null) {
    const pattern = m[2] ?? "";
    if (/^\^?\.\*\$?$/.test(pattern) || (!pattern.includes("^") && !pattern.includes("$"))) {
      grants.push({ index: m.index, kind: "allow-all", detail: `origin regex \`${pattern}\` is not anchored` });
    }
  }

  grants.push(...gatewayMatchGrants(body));
  if (JVM_FILE.test(file.relPath)) grants.push(...jvmOriginGrants(body, env));

  // Permissive predicates only count in a file that actually decides a CORS policy.
  if (CORS_CONTEXT.test(body)) {
    for (const re of [PREDICATE_JS, PREDICATE_PY]) {
      re.lastIndex = 0;
      while ((m = re.exec(body)) !== null) {
        if (!ORIGIN_RECEIVER.test(m[1] ?? "")) continue;
        grants.push({
          index: m.index,
          kind: "predicate",
          detail: `\`${m[1]}.${m[2]}(…)\` is a substring test, not an exact match`,
        });
      }
    }
    PREDICATE_GO.lastIndex = 0;
    while ((m = PREDICATE_GO.exec(body)) !== null) {
      const recv = (m[2] ?? "").split(".").pop()!;
      if (!ORIGIN_RECEIVER.test(recv)) continue;
      grants.push({
        index: m.index,
        kind: "predicate",
        detail: `\`strings.${m[1]}\` is a substring test, not an exact match`,
      });
    }
    PREDICATE_REGEX.lastIndex = 0;
    while ((m = PREDICATE_REGEX.exec(body)) !== null) {
      const pattern = m[2] ?? "";
      if (!ORIGIN_RECEIVER.test(m[1] ?? "")) continue;
      if (pattern.includes("^") && pattern.includes("$")) continue;
      grants.push({ index: m.index, kind: "predicate", detail: `origin regex \`${pattern}\` is not anchored` });
    }
  }

  return grants;
}

/**
 * Grants from a gateway's `allow_origin_string_match` list. Each entry is one matcher; only
 * `exact` names an origin. Everything else describes a family of origins that includes ones
 * the attacker can register, which is the whole bug — there is no `*` in this shape.
 */
function gatewayMatchGrants(body: string): OriginGrant[] {
  const grants: OriginGrant[] = [];
  ORIGIN_MATCH_LIST.lastIndex = 0;
  let key: RegExpExecArray | null;
  while ((key = ORIGIN_MATCH_LIST.exec(body)) !== null) {
    const block = structuredValueBlock(body, key.index + key[0].length, key.index);
    if (!block.text) continue;

    ORIGIN_MATCHER.lastIndex = 0;
    let entry: RegExpExecArray | null;
    while ((entry = ORIGIN_MATCHER.exec(block.text)) !== null) {
      const kind = (entry[1] ?? "").toLowerCase().replace("_", "");
      const at = block.start + entry.index;
      const value = unwrap(valueAfter(block.text, entry.index + entry[0].length));

      // `safe_regex` is a wrapper; the pattern it wraps is matched as its own `regex` entry.
      if (kind === "saferegex") continue;
      if (value === "*") {
        grants.push({ index: at, kind: "wildcard", detail: "`*`" });
        continue;
      }
      if (kind === "exact") continue;
      if (kind === "regex") {
        if (/^\^?\.\*\$?$/.test(value)) {
          grants.push({ index: at, kind: "allow-all", detail: `origin regex \`${value}\` matches every origin` });
        } else if (!value.includes("^") || !value.includes("$")) {
          grants.push({ index: at, kind: "predicate", detail: `origin regex \`${value}\` is not anchored` });
        }
        continue;
      }
      grants.push({
        index: at,
        kind: "predicate",
        detail:
          kind === "suffix"
            ? `\`suffix: "${value}"\` also matches \`https://evil-${value.replace(/^https?:\/\//, "")}\``
            : kind === "prefix"
              ? `\`prefix: "${value}"\` also matches \`${value}.attacker.example\``
              : `\`contains: "${value}"\` matches any origin containing that string`,
      });
    }
  }
  return grants;
}

/**
 * Grants from Spring's CORS builders (`CorsRegistry`, `CorsConfiguration`, `@CrossOrigin`).
 * `allowedOriginPatterns("*")` is the dangerous one: unlike `allowedOrigins("*")` Spring does
 * not reject it when credentials are enabled, it answers the caller's own origin instead.
 */
function jvmOriginGrants(body: string, env: FoldEnv): OriginGrant[] {
  const grants: OriginGrant[] = [];
  // Not `stripComments`: it rewrites the text, and every index here has to stay an offset into
  // the real file. Commented-out policy is dropped by the caller's per-line comment check.
  const source = body;

  const pushValues = (index: number, values: string[]) => {
    for (const value of values) {
      const cls = classifyJavaOrigin(value, env);
      if (cls) grants.push({ index, kind: cls.kind, detail: cls.detail });
    }
  };

  JAVA_ORIGIN_CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JAVA_ORIGIN_CALL.exec(source)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(source, open);
    if (close < 0) continue;
    const args = splitTopLevelArgs(source.slice(open + 1, close));
    pushValues(
      m.index,
      args.flatMap((a) => javaOriginValues(a)),
    );
  }

  CROSS_ORIGIN_ANNOTATION.lastIndex = 0;
  while ((m = CROSS_ORIGIN_ANNOTATION.exec(source)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(source, open);
    if (close < 0) continue;
    for (const arg of splitTopLevelArgs(source.slice(open + 1, close))) {
      const named = /^(\w+)\s*=\s*([\s\S]+)$/.exec(arg);
      if (named && !CROSS_ORIGIN_ATTR.test(named[1]!)) continue;
      pushValues(m.index, javaOriginValues(named ? named[2]! : arg));
    }
  }

  return grants;
}

/* ── detector ───────────────────────────────────────────────────────────────────────── */

const MAX_PER_FILE = 4;

export const corsDetector: Detector = {
  classIds: ["cors-misconfig"],
  tier: "verified",
  run(ctx: ScanContext): DetectorFinding[] {
    const findings: DetectorFinding[] = [];
    const env: FoldEnv = {
      files: ctx.files,
      springProps: collectSpringProps(ctx.files),
      nginxMaps: collectNginxMaps(ctx.files),
    };

    for (const file of ctx.files) {
      const base = file.relPath.slice(file.relPath.lastIndexOf("/") + 1).toLowerCase();
      if (!CORS_FILE.test(file.relPath) && !CORS_FILE_BASENAMES.has(base)) continue;
      if (!CORS_CONTEXT.test(file.content)) continue;

      const srcLines = file.content.split(/\r?\n/);
      const spans = bracketSpans(file.content, isHashComment(file.relPath));
      const titles = testTitleSpans(file.content);
      const configSurface = isConfigSurface(file.relPath);
      const yamlSurface = /\.ya?ml$/i.test(file.relPath);
      const seen = new Set<number>();
      let emitted = 0;

      for (const grant of collectGrants(file, env)) {
        if (emitted >= MAX_PER_FILE) break;
        const line = lineAtIndex(file.content, grant.index);
        if (seen.has(line)) continue;
        const srcLine = srcLines[line - 1] ?? "";
        if (isCommentLine(srcLine)) continue;
        if (ASSERTION_LINE.test(srcLine)) continue;
        if (inSpan(titles, grant.index)) continue; // a test's name, not a policy

        /* A reverse-proxy `location` (or any config block) is a real isolation boundary:
           the API block's credentials say nothing about the static-asset block's wildcard.
           A gateway YAML has the same boundaries but expresses them with indentation rather
           than brackets, so it needs its own scope walk. Application files are a single
           module, so a file-level fallback is fair there. */
        const scope = yamlSurface ? yamlScopeAt(file.content, grant.index) : scopeAt(file.content, spans, grant.index);
        const creds = credentialState(scope, file.content, !configSurface);

        if (creds === "off") continue;
        if (creds === "unknown" && PUBLIC_RESOURCE.test(scope) && !AUTH_TRAFFIC.test(scope)) continue;
        if (grant.kind === "reflected" && isAllowlistGated(scope, stripComments(file.content))) continue;

        /* Credentials are what turn "any origin may read this" into "any origin may read
           this user's data", so they set severity; without them the grant is still a
           finding, just a lower one. */
        const severity: Severity = creds === "on" ? "high" : "medium";

        seen.add(line);
        emitted++;

        const what =
          grant.kind === "wildcard"
            ? `a wildcard CORS origin (${grant.detail})`
            : grant.kind === "reflected"
              ? `a reflected CORS origin — the allowed origin is ${grant.detail}`
              : grant.kind === "allow-all"
                ? `an allow-all CORS policy (${grant.detail})`
                : `a permissive CORS origin check — ${grant.detail}`;

        findings.push({
          tier: "verified",
          classId: "cors-misconfig",
          severity,
          surfaces: file.surfaces,
          locations: [{ path: file.relPath, startLine: line, endLine: line, surface: file.surfaces[0]! }],
          explanation:
            `${file.relPath}:${line} configures ${what}. ` +
            (creds === "on"
              ? "Credentials are enabled on the same policy, so any origin can read authenticated responses."
              : "Any origin can read responses from this endpoint."),
          reproduction: {
            kind: "inspection",
            steps: [
              `Open ${file.relPath} at line ${line}.`,
              `Observe ${what}${creds === "on" ? " together with Access-Control-Allow-Credentials enabled" : ""}.`,
              `Send a request from an unrelated origin and read the Access-Control-Allow-Origin response header.`,
            ],
            expected: `A page on any origin can read${creds === "on" ? " authenticated" : ""} responses from this endpoint.`,
          },
        });
      }
    }

    return findings;
  },
};
