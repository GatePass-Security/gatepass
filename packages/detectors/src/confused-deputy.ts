import type { Detector, DetectorFinding, ScanContext, ScanFile } from "@gatepass/engine";
import type { Surface } from "@gatepass/findings";

/**
 * Research-tier detector: confused deputy.
 *
 * The shape: a privileged credential is attached to an outbound request whose DESTINATION the
 * caller controls. The server lends its authority to whoever asks, and the caller reaches
 * resources they could not reach themselves — or, in the mirror-image case, the caller's own
 * bearer token is shipped to a host the caller nominates and is simply stolen.
 *
 * Both halves have to be judged, and each is easy to get wrong:
 *
 *  - DESTINATION. Caller-controlled does not mean "contains a variable". `${BASE}/${id}` is a
 *    fixed host with a caller-supplied path segment and is fine. The interesting case is
 *    `new URL(callerValue, BASE)`: it reads like a safe base-plus-path join, but an absolute
 *    `callerValue` silently discards the base, so the caller picks the host after all. So the
 *    question is whether the *origin* is pinned to a literal, not whether the string is dynamic.
 *
 *  - CREDENTIAL. It is frequently not attached at the call site. An axios interceptor, or a
 *    `requests.Session` with default headers, attaches it once — often in another file — and
 *    every later call inherits it. Analysing only the line with `fetch(` on it sees nothing.
 *
 * Three things make an otherwise-matching call site clean, and all three are real designs:
 * an allow-list check on the destination host before the credential is attached; forwarding a
 * caller-scoped (exchanged/delegated) token instead of the service credential; and stripping
 * credentials at an egress boundary.
 */

type Lang = "js" | "py" | "go" | "java";

function langOf(relPath: string): Lang | null {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(relPath)) return "js";
  if (/\.py$/i.test(relPath)) return "py";
  if (/\.go$/i.test(relPath)) return "go";
  if (/\.java$/i.test(relPath)) return "java";
  return null;
}

function blankComments(src: string, lang: Lang): string {
  const out = src.split("");
  let i = 0;
  let str: string | null = null;
  const lineComment = lang === "py" ? "#" : "//";
  while (i < src.length) {
    const c = src[i]!;
    if (str) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === str) str = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      i++;
      continue;
    }
    if (src.startsWith(lineComment, i)) {
      while (i < src.length && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (lang !== "py" && c === "/" && src[i + 1] === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      out[i] = " ";
      if (i + 1 < src.length) out[i + 1] = " ";
      i += 2;
      continue;
    }
    i++;
  }
  return out.join("");
}

function matchBrace(src: string, open: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") str = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return src.length;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < Math.min(index, content.length); i++) if (content[i] === "\n") line++;
  return line;
}

/** Split a call's argument list (already excluding the outer parens) at top-level commas. */
function splitArgs(src: string, openParen: number): { args: string[]; end: number } {
  const args: string[] = [];
  let depth = 0;
  let str: string | null = null;
  let start = openParen + 1;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i]!;
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") str = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        args.push(src.slice(start, i));
        return { args, end: i };
      }
    } else if (c === "," && depth === 1) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return { args, end: src.length };
}

/* ── Scopes ──────────────────────────────────────────────────────────────────────────── */

interface Scope {
  name: string;
  start: number;
  end: number;
  text: string;
}

const JS_FN =
  /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)?\s*\(|(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\s*\*?\s*)?\(|\b(\w+)\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*(?::[^=>]+)?=>/g;
const GO_FN = /func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/g;
/**
 * A Java method header: modifiers, a return type, the name, the parameter list. The return type
 * is what separates it from a field initialiser (`private final String token = getenv(...)`) —
 * `=` is deliberately absent from the type character class, so an assignment can never be read
 * as a method.
 */
const JAVA_FN =
  /\b(?:public|private|protected)\s+(?:static\s+|final\s+|synchronized\s+|abstract\s+|native\s+|default\s+)*[\w<>[\].,\s]+?\s(\w+)\s*\(/g;
const PY_FN = /^([ \t]*)(?:async\s+)?def\s+(\w+)\s*\(/gm;

function extractScopes(content: string, lang: Lang): Scope[] {
  const scopes: Scope[] = [];
  if (lang === "py") {
    const lines = content.split(/\r?\n/);
    const offsets: number[] = [];
    let acc = 0;
    for (const l of lines) {
      offsets.push(acc);
      acc += l.length + 1;
    }
    lines.forEach((line, i) => {
      const m = /^([ \t]*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(line);
      if (!m) return;
      const base = m[1]!.length;
      let end = lines.length - 1;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]!;
        if (l.trim() === "") continue;
        if (l.length - l.trimStart().length <= base) {
          end = j - 1;
          break;
        }
      }
      const startOff = offsets[i]!;
      const endOff = (offsets[end] ?? startOff) + (lines[end]?.length ?? 0);
      scopes.push({ name: m[2]!, start: startOff, end: endOff, text: content.slice(startOff, endOff) });
    });
    return scopes;
  }

  const re = lang === "go" ? GO_FN : lang === "java" ? JAVA_FN : JS_FN;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const name = m[1] ?? m[2] ?? m[3] ?? "(anonymous)";
    const open = content.indexOf("{", m.index + m[0].length - 1);
    if (open < 0) continue;
    const end = matchBrace(content, open);
    scopes.push({ name, start: m.index, end, text: content.slice(m.index, end + 1) });
  }
  return scopes;
}

/**
 * Innermost scope containing `offset`, or `fallback` (the whole module) when the call sits at
 * module level. The fallback is passed in rather than built here so every module-level call site
 * shares one object — the analysis of a scope is cached by identity, and a bundle with thousands
 * of module-level calls would otherwise re-scan the entire file once per call.
 */
function scopeAt(scopes: Scope[], offset: number, fallback: Scope): Scope {
  let best: Scope | null = null;
  for (const s of scopes) {
    if (offset < s.start || offset > s.end) continue;
    if (!best || s.end - s.start < best.end - best.start) best = s;
  }
  return best ?? fallback;
}

/* ── Destination: is the ORIGIN pinned to a literal? ─────────────────────────────────── */

/**
 * Deployment configuration — an environment variable, a settings object populated from one. The
 * threat here is a destination the CALLER chooses; a base URL the operator sets at deploy time is
 * as pinned as a literal, and treating it as dynamic makes every `process.env.API_BASE` service
 * client look like a confused deputy.
 */
const CONFIG_READ =
  /(process\.env)|(import\.meta\.env)|(Deno\.env)|(os\.environ)|(os\.getenv)|(os\.Getenv)|(System\.getenv)|(\bgetenv\s*\()|(\bENV\s*\[)|(\bViper\s*\.)|(\bsettings\s*\.\s*[A-Z_]{3,})/;

/** Format-string composition where the format is argument 0: `fmt.Sprintf(f, a)`, `String.format(f, a)`. */
const FORMAT_ARG0 = /^(?:[\w$]+\s*\.\s*)*(?:Sprintf|Sprint|Sprintln|Errorf|sprintf|printf|format|Format)\s*\(/;
/** ... and where the format is the receiver: `"{}/orders".format(base)`, `"%s/x".formatted(base)`. */
const FORMAT_RECEIVER = /^[fbru]{0,2}(["'`])(?:[^"'`\\]|\\.)*\1\s*\.\s*(?:format|formatted|Format)\s*\(/;
/** A format verb or brace placeholder at the head of a format string. */
const FORMAT_VERB = /^(?:%[-+ #0-9.*]*[a-zA-Z]|\{\d*\}|\{[A-Za-z_]\w*(?::[^}]*)?\})/;

/**
 * The literal text at the very start of `expr`, stopping at the closing quote or at the first
 * interpolation. Returns `null` when the expression does not begin with a string literal.
 */
function literalHead(expr: string): { text: string; rest: string } | null {
  const m = /^[fbru]{0,2}(["'`])/.exec(expr);
  if (!m) return null;
  const quote = m[1]!;
  const fstring = m[0].length > 1;
  let text = "";
  for (let i = m[0].length; i < expr.length; i++) {
    const c = expr[i]!;
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === quote) return { text, rest: expr.slice(i + 1) };
    if ((quote === "`" && c === "$" && expr[i + 1] === "{") || (fstring && c === "{")) {
      return { text, rest: expr.slice(i) };
    }
    text += c;
  }
  return { text, rest: "" };
}

/**
 * Whether an absolute-URL literal pins the origin. `https://api.example.com/x` does.
 * `https://` on its own does NOT: the authority is whatever is concatenated or interpolated
 * next, which is precisely the caller-chosen-host shape (`"https://" + req.host()`). Returns
 * `null` when the literal is not an absolute URL at all.
 */
function schemeLiteralPins(head: string): boolean | null {
  const m = /^\s*[a-z][a-z0-9+.-]*:\/\/([\s\S]*)$/i.exec(head);
  if (!m) return null;
  return /^[^/?#\s]/.test(m[1]!);
}

/** The first substituted term after a literal head: `${x}` / `{x}` / `+ x`. */
function termAfterHead(rest: string): string | null {
  const interp = /^\s*(?:\$\{|\{)\s*([^}]+)\}/.exec(rest);
  if (interp) return interp[1]!.trim();
  const plus = /^\s*\+\s*([^+\n]+)/.exec(rest);
  if (plus) return plus[1]!.trim();
  return null;
}

/** Split `a ?? b`, `a || b`, `a or b` at the top level. */
function splitDefaults(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let str: string | null = null;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!;
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") str = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0) {
      let width = 0;
      if ((c === "?" && expr[i + 1] === "?") || (c === "|" && expr[i + 1] === "|")) width = 2;
      else if (expr.startsWith(" or ", i)) width = 4;
      if (width > 0) {
        parts.push(expr.slice(start, i));
        i += width - 1;
        start = i + 1;
      }
    }
  }
  if (parts.length === 0) return [expr];
  parts.push(expr.slice(start));
  return parts.filter((p) => p.trim() !== "");
}

function assignmentsIn(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(?:const|let|var)?\s*\b(\w+)\s*(?::=|=)\s*([^\n;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1]!;
    if (!map.has(name)) map.set(name, m[2]!.trim());
  }
  return map;
}

/**
 * `fixed` means the request's origin cannot be chosen by the caller. Anything else is treated
 * as caller-controlled — including the `new URL(x, BASE)` join, which looks pinned and is not.
 */
function originIsFixed(expr: string, locals: Map<string, string>, mods: Map<string, string>, depth = 0): boolean {
  const e = expr.trim().replace(/^await\s+/, "");
  if (depth > 5 || e === "") return false;

  // `new URL(value, BASE)` — an absolute `value` discards BASE, so the caller picks the host.
  const urlJoin = /^(?:new\s+)?(?:URL|urljoin|url\.Parse|urlparse)\s*\(/.exec(e);
  if (urlJoin) {
    const { args } = splitArgs(e, e.indexOf("(", urlJoin[0].length - 1));
    return originIsFixed(args[0] ?? "", locals, mods, depth + 1);
  }

  // Format-string composition. `fmt.Sprintf("%s/invoices/%s", base, id)` reads as "dynamic
  // string" to a pattern matcher and is in fact a pinned host with a caller-supplied path
  // segment — the single most common way a Go or Java service builds a safe internal URL.
  const fmtArg0 = FORMAT_ARG0.exec(e);
  if (fmtArg0) {
    const { args } = splitArgs(e, e.indexOf("(", fmtArg0[0].length - 1));
    return formatOriginFixed(args[0] ?? "", args.slice(1), locals, mods, depth + 1);
  }
  const fmtRecv = FORMAT_RECEIVER.exec(e);
  if (fmtRecv) {
    const open = e.indexOf("(", fmtRecv[0].length - 1);
    const { args } = splitArgs(e, open);
    return formatOriginFixed(e.slice(0, open), args, locals, mods, depth + 1);
  }

  // `process.env.BASE ?? "https://fallback"` — every alternative has to be operator-chosen.
  const alts = splitDefaults(e);
  if (alts.length > 1) return alts.every((a) => originIsFixed(a, locals, mods, depth + 1));

  // A literal head: an absolute URL pins the origin only if the authority is in the literal.
  const lit = literalHead(e);
  if (lit) {
    const pinned = schemeLiteralPins(lit.text);
    if (pinned === true) return true;
    if (pinned === false) {
      const next = termAfterHead(lit.rest);
      return next !== null && resolvesToLiteral(next, locals, mods, depth + 1);
    }
    // Template literal / f-string beginning with an interpolation — `${API}/orgs/...`. The
    // interpolated value is the origin, so the question becomes whether *it* is pinned.
    if (lit.text.trim() === "") {
      const ident = /^\s*(?:\$\{|\{)\s*([\w.]+)\s*\}/.exec(lit.rest);
      if (ident) return resolveIdent(ident[1]!, locals, mods, depth);
    }
  }

  // Concatenation: the head decides the origin.
  const concat = /^([^+]+)\+/.exec(e);
  if (concat) return originIsFixed(concat[1]!, locals, mods, depth + 1);

  // A destination read from deployment configuration is chosen by the operator, not the caller.
  if (CONFIG_READ.test(e)) return true;

  // Bare identifier.
  if (/^[\w.$]+$/.test(e)) return resolveIdent(e, locals, mods, depth);
  return false;
}

/**
 * The origin of a formatted URL. `"https://host/%s"` is pinned outright; `"%s/invoices/%s"` hands
 * the whole origin to its first substitution; `"https://%s/x"` hands only the authority over, so
 * it is pinned exactly when that substitution resolves to a literal.
 */
function formatOriginFixed(
  fmtExpr: string,
  args: string[],
  locals: Map<string, string>,
  mods: Map<string, string>,
  depth: number,
): boolean {
  let head = literalHead(fmtExpr.trim());
  if (!head) {
    // The format may itself be a named constant.
    const name = fmtExpr.trim();
    const rhs = /^[A-Za-z_$][\w$]*$/.test(name) ? (locals.get(name) ?? mods.get(name)) : undefined;
    if (rhs === undefined || depth > 5) return false;
    head = literalHead(rhs.trim());
    if (!head) return false;
  }
  const pinned = schemeLiteralPins(head.text);
  if (pinned === true) return true;
  if (pinned === false) {
    const authority = head.text.slice(head.text.indexOf("//") + 2);
    if (!FORMAT_VERB.test(authority)) return false;
    return args.length > 0 && resolvesToLiteral(args[0]!, locals, mods, depth + 1);
  }
  if (FORMAT_VERB.test(head.text)) return args.length > 0 && originIsFixed(args[0]!, locals, mods, depth + 1);
  return false;
}

/** Does this expression resolve to a fixed piece of text — a literal or a configured value? */
function resolvesToLiteral(
  expr: string,
  locals: Map<string, string>,
  mods: Map<string, string>,
  depth: number,
): boolean {
  const e = expr.trim().replace(/^await\s+/, "");
  if (depth > 5 || e === "") return false;
  if (CONFIG_READ.test(e)) return true;
  const lit = literalHead(e);
  // A literal that immediately continues into an interpolation is only partly fixed — the
  // variable part can still be the authority (`"api." + tenant + ".example.com"`).
  if (lit && lit.text.length > 0 && termAfterHead(lit.rest) === null) return true;
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const rhs = locals.get(e) ?? mods.get(e);
    return rhs !== undefined && resolvesToLiteral(rhs, locals, mods, depth + 1);
  }
  return false;
}

function resolveIdent(name: string, locals: Map<string, string>, mods: Map<string, string>, depth: number): boolean {
  if (name.includes(".")) return false; // member access on caller data (`d.CallbackURL`, `body.url`)
  const rhs = locals.get(name) ?? mods.get(name);
  if (rhs === undefined) return false;
  return originIsFixed(rhs, locals, mods, depth + 1);
}

/* ── Credentials ─────────────────────────────────────────────────────────────────────── */

const AUTH_HEADER_KV =
  /(["'`]?)(authorization|proxy-authorization|x-api-key|api[-_]?key|apikey|x-auth-token|x-access-token|x-internal-api-key|x-service-token|cookie|x-[\w-]*(?:token|key|secret))\1\s*[:=]\s*([^,\n]+)/gi;
/**
 * `headers["Authorization"] = ...` / `defaults.headers.common["X-Api-Key"] = ...`. The bracket
 * form is how default credentials are attached to a shared client, and the key/value regex above
 * cannot see it: the `]` sits between the quoted key and the `=`.
 */
const HEADER_INDEX_SET = /head(?:er|ers)?\s*(?:\.\s*common\s*)?\[\s*(["'`])([\w-]+)\1\s*\]\s*=\s*([^\n;]+)/gi;
const AUTH_HEADER_NAME =
  /^(authorization|proxy-authorization|x-api-key|api[-_]?key|apikey|x-auth-token|x-access-token|x-internal-api-key|x-service-token|cookie|x-[\w-]*(?:token|key|secret))$/i;
const GO_HEADER_SET = /\.\s*Header\s*\.\s*(?:Set|Add)\s*\(\s*["`]([\w-]+)["`]\s*,\s*([^\n]+?)\)\s*$/gim;
/**
 * A header set through a builder call rather than a map: `.header("X-Internal-Token", token)`
 * (java.net.http, OkHttp), `.setHeader(...)` (Apache HttpClient), `.setRequestProperty(...)`
 * (HttpURLConnection), `.set("Authorization", ...)` (superagent). The name and the value are two
 * arguments, so the `key: value` scan cannot see it at all.
 */
const BUILDER_HEADER_SET =
  /\.\s*(?:header|setHeader|addHeader|setRequestProperty|set)\s*\(\s*["'`]([\w-]+)["'`]\s*,\s*([^\n]+?)\s*\)/g;
const BASIC_AUTH = /(SetBasicAuth\s*\(|auth\s*=\s*\(|HTTPBasicAuth\s*\(|auth\s*=\s*[A-Za-z_]\w*Auth\s*\()/;

const OWN_SECRET =
  /(process\.env)|(import\.meta\.env)|(os\.environ)|(os\.getenv)|(os\.Getenv)|(Deno\.env)|(ENV\s*\[)|(getenv\s*\()|(\bsecrets?\s*\.)|(\b[A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|APIKEY)[A-Z0-9_]*\b)|(\b(?:service|admin|root|master|internal|system|app|client|partner|mesh)[_-]?(?:token|key|secret|credential)\b)/i;
const CALLER_CRED =
  /(\breq(?:uest)?\s*\.\s*head(?:er|ers))|(head(?:er|ers)?\s*\.\s*get\s*\(\s*["'`]\s*authorization)|(\bctx\s*\.\s*(?:auth|token))|(\bincoming[_ ]?(?:auth|token))|(\bcaller[_ ]?(?:auth|token))|(\bauth(?:orization)?[_ ]?header\b)|(\br\s*\.\s*Header\s*\.\s*Get\s*\()/i;
/** A token minted FOR the caller carries only the caller's authority — not the server's. */
const DELEGATED =
  /(delegat)|(exchang)|(on[_-]?behalf)|(\bobo\b)|(subject_token)|(impersonat)|(downscop)|(scoped[_-]?token)|(act[_-]?as)/i;

type CredKind = "service" | "forwarded" | null;

function classifyCredValue(raw: string, locals: Map<string, string>, mods: Map<string, string>, depth = 0): CredKind {
  const v = raw.trim().replace(/[)};,\s]+$/, "");
  if (v === "" || depth > 3) return null;
  if (DELEGATED.test(v)) return null;
  if (CALLER_CRED.test(v)) return "forwarded";
  if (OWN_SECRET.test(v)) return "service";
  // The credential is usually a named constant reached through an interpolation or a concat
  // (`f"Bearer {KEY}"`, `"Bearer " + token`). Resolve every identifier in the value, not just
  // the case where the whole value is one bare name.
  for (const id of v.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    const rhs = locals.get(id) ?? mods.get(id);
    if (rhs === undefined || rhs.trim() === v) continue;
    const kind = classifyCredValue(rhs, locals, mods, depth + 1);
    if (kind) return kind;
  }
  return null;
}

/** Auth material attached anywhere in `text` (a scope, or an interceptor body). */
function credentialIn(text: string, locals: Map<string, string>, mods: Map<string, string>): CredKind {
  let kind: CredKind = null;
  const scan = (re: RegExp, valueGroup: number) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const k = classifyCredValue(m[valueGroup] ?? "", locals, mods);
      if (k === "forwarded") kind = "forwarded";
      else if (k === "service" && kind === null) kind = "service";
    }
  };
  scan(AUTH_HEADER_KV, 3);
  scan(GO_HEADER_SET, 2);
  const named = (re: RegExp, nameGroup: number, valueGroup: number) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!AUTH_HEADER_NAME.test(m[nameGroup] ?? "")) continue;
      const k = classifyCredValue(m[valueGroup] ?? "", locals, mods);
      if (k === "forwarded") kind = "forwarded";
      else if (k === "service" && kind === null) kind = "service";
    }
  };
  named(HEADER_INDEX_SET, 2, 3);
  named(BUILDER_HEADER_SET, 1, 2);
  if (kind === null && BASIC_AUTH.test(text) && OWN_SECRET.test(text)) kind = "service";
  return kind;
}

/* ── Mitigations ─────────────────────────────────────────────────────────────────────── */

const HOST_EXTRACT =
  /(urlparse|urlsplit)\s*\(|new\s+URL\s*\(|url\.Parse\s*\(|\.\s*hostname\b|\.\s*host\b|\.\s*Host\b|getHost\w*\s*\(/;
/**
 * Naming for an allow-list is unbounded (`ALLOWED_HOSTS`, `permittedHosts`, `trustedDomains`,
 * `KNOWN_ENDPOINTS`, ...), so matching one spelling would repeat the overfit this detector is
 * meant to avoid. Instead require the two ideas to meet on a single line: a gate-ish stem and
 * a destination-ish noun.
 */
const ALLOWLIST_STEM =
  /\b\w*(?:allow|permit|whitelist|trusted|approved|sanctioned|expected|supported|valid|safe|known|registered)\w*\b/i;
const DESTINATION_NOUN = /\b\w*(?:host|domain|origin|url|uri|endpoint|target|destination|fqdn|netloc|authority)\w*\b/i;
const MEMBERSHIP =
  /(\bnot\s+in\b)|(\bin\s+[A-Z_a-z])|(\.\s*includes\s*\()|(\.\s*has\s*\()|(\.\s*indexOf\s*\()|(\bcontains\b)|(\[\s*[\w.]+\s*\])|(\.\s*some\s*\()|(\.\s*any\s*\()/;
const REJECT =
  /(\bthrow\b)|(\braise\b)|(HTTPException)|(\babort\s*\()|(http\.Error)|(status(?:_code)?\s*[=(]\s*4)|(\.\s*status\s*\(\s*4)|(Forbidden)|(Unauthorized)|(\bdenied?\b)|(not\s+allow)|(not\s+permitted)|(return\s+(?:nil\s*,\s*)?(?:err|error|false|None))/i;

function hasHostAllowlist(fileText: string): boolean {
  if (!HOST_EXTRACT.test(fileText) || !MEMBERSHIP.test(fileText) || !REJECT.test(fileText)) return false;
  return fileText.split(/\r?\n/).some((l) => ALLOWLIST_STEM.test(l) && DESTINATION_NOUN.test(l));
}

const STRIPS_CREDENTIALS =
  /((?:delete\s+[\w.]*head(?:er|ers)?\s*[.[])|(?:head(?:er|ers)?\s*\.\s*delete\s*\()|(?:del\s+[\w.]*head\w*\s*[.[])|(?:\.\s*Header\s*\.\s*Del\s*\()|(?:\bstrip\w*\b)|(?:\bredact\w*\b)|(?:\bscrub\w*\b)|(?:sanitize\w*head)|(?:remove\w*(?:auth|credential|header)))/i;

function stripsCredentials(fileText: string): boolean {
  return STRIPS_CREDENTIALS.test(fileText) && /authorization/i.test(fileText);
}

/* ── Credentialed clients configured away from the call site ─────────────────────────── */

/**
 * The interesting call sites contain no credential text at all. The request goes out through a
 * client object that was built — and credentialed — somewhere else: an axios instance with a
 * request interceptor, a `requests.Session` whose default headers are set at import time, a Go
 * `http.Client` whose `Transport` is a credential-injecting `RoundTripper`. Reading only the
 * calling file sees a bare `http.get(userUrl)` and nothing to report.
 *
 * So the client is resolved back to the module that constructs it, and inherits every credential
 * attached to it anywhere in the repo — including credentials attached indirectly, by an
 * interceptor / transport / hook *registered on* the client rather than passed at the call.
 *
 * The registration is deliberately narrow in one respect: a credential attachment only counts
 * when the receiving symbol is a client this pass actually saw constructed, or one imported from
 * another module. Without that, `config.headers.Authorization = ...` inside an interceptor body
 * would register `config` as a credentialed client, and `app.use(auth)` would turn every Express
 * route into an outbound request.
 */
interface ClientPrepass {
  /** Identifier names of HTTP clients that carry a credential by default (JS/Python). */
  names: Set<string>;
  /** Module keys (extension-less path; package directory for Go) exporting such a client. */
  modules: Set<string>;
  /** Credentialed client symbols, keyed by the module that constructs or exports them. */
  symbols: Map<string, Set<string>>;
}

/** JS/Python modules are identified by their extension-less path; Go packages by directory. */
function moduleKeyOf(relPath: string, lang: Lang): string {
  if (lang === "go") {
    const i = relPath.lastIndexOf("/");
    return i < 0 ? "." : relPath.slice(0, i);
  }
  return relPath.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py)$/i, "");
}

function lastSegment(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

/**
 * Minified build output — one enormous line with no structure. `buildScanContext` deliberately
 * ingests `dist/`, so a bundle with thousands of `new XClient(` fragments would otherwise drag
 * this cross-module pass into quadratic behaviour for no possible signal: the shared client's
 * *definition* is not recoverable from a bundle. Call-site analysis still runs on it.
 */
function looksGenerated(content: string): boolean {
  if (content.length < 50_000) return false;
  let newlines = 0;
  let lineStart = 0;
  let longest = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) !== 10) continue;
    newlines++;
    if (i - lineStart > longest) longest = i - lineStart;
    lineStart = i + 1;
  }
  if (content.length - lineStart > longest) longest = content.length - lineStart;
  // One 2000-character line is a bundle, not something a person typed.
  return longest > 2000 || content.length / (newlines + 1) > 300;
}

/** Argument lists are read through a fixed window so one unterminated paren cannot cost a file. */
const ARG_WINDOW = 4000;
function windowedArgs(content: string, open: number): string[] {
  return splitArgs(content.slice(open, open + ARG_WINDOW), 0).args;
}

/** Where a client object is brought into existence, per language. */
const CLIENT_CONSTRUCTION: { lang: Lang; re: RegExp; brace?: boolean }[] = [
  // `const api = axios.create({...})`, `const gh = octokit.extend({...})`
  {
    lang: "js",
    re: /(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:await\s+)?[\w.]+\.\s*(?:create|extend|withDefaults)\s*\(/g,
  },
  // `const api = new ApiClient({...})`
  {
    lang: "js",
    re: /(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:await\s+)?new\s+[\w.]*(?:Client|Session|Api|Agent|Http|Fetcher|Transport)\w*\s*\(/g,
  },
  // `session = requests.Session()`, `client = httpx.AsyncClient(...)`
  { lang: "py", re: /^[ \t]*(\w+)\s*=\s*(?:await\s+)?[\w.]+\.\s*(?:Session|Client|AsyncClient|ClientSession)\s*\(/gm },
  // `var Client = &http.Client{...}`, `c := &http.Client{...}`
  { lang: "go", re: /(?:var\s+)?(\w+)\s*:?=\s*&?\s*(?:\w+\.)?Client\s*\{/g, brace: true },
];

/**
 * Wirings that attach a credential to a client without passing it at the call. `strong` forms are
 * unmistakably HTTP-client configuration and are accepted for imported symbols too; the generic
 * middleware forms are accepted only for a symbol constructed in this same file.
 */
const STRONG_WIRES: { re: RegExp; args: boolean }[] = [
  { re: /(\w+)\s*\.\s*interceptors\s*\.\s*request\s*\.\s*use\s*\(/g, args: true },
  { re: /(\w+)\s*\.\s*head(?:er|ers)?\s*\.\s*update\s*\(/g, args: true },
  { re: /(\w+)\s*\.\s*defaults\s*\.\s*head(?:er|ers)?\b/g, args: false },
  { re: /(\w+)\s*\.\s*head(?:er|ers)?\s*[.[]/g, args: false },
  { re: /(\w+)\s*\.\s*auth\s*=[^=]/g, args: false },
  { re: /(\w+)\s*\.\s*Transport\s*=[^=]/g, args: false },
  {
    re: /(\w+)\s*\.\s*(?:setHeader|set)\s*\(\s*["'`](?:authorization|proxy-authorization|cookie|api[-_]?key|apikey|x-[\w-]*(?:token|key|secret))/gi,
    args: true,
  },
  { re: /(\w+)\s*\.\s*event_hooks\b/g, args: false },
];
const WEAK_WIRES: { re: RegExp; args: boolean }[] = [
  { re: /(\w+)\s*\.\s*(?:use|mount|addMiddleware|middleware)\s*\(/g, args: true },
  { re: /(\w+)\s*\.\s*hooks\s*[.[]/g, args: false },
];

/**
 * Identifiers that are never a client symbol and never worth a definition lookup. Note that
 * `http`/`axios`/`session` are deliberately absent: `const http = axios.create(...)` is the most
 * common name for exactly the shared client this pass exists to find.
 */
const WIRE_NOISE = new Set([
  "new",
  "await",
  "async",
  "function",
  "return",
  "this",
  "self",
  "true",
  "false",
  "null",
  "None",
  "nil",
  "err",
  "error",
  "string",
  "number",
  "config",
  "cfg",
  "req",
  "request",
  "res",
  "response",
  "headers",
  "header",
  "options",
  "opts",
  "ctx",
  "context",
  "base",
  "next",
  "Transport",
  "DefaultTransport",
  "Timeout",
  "time",
  "os",
  "const",
  "let",
  "var",
]);

/** Body of a same-file definition, so a wiring that names a handler can be followed one hop. */
function definitionBody(name: string, content: string, lang: Lang, cache: Map<string, string>): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const body = computeDefinitionBody(name, content, lang);
  cache.set(name, body);
  return body;
}

const DEF_WINDOW = 2000;

function computeDefinitionBody(name: string, content: string, lang: Lang): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(name) || WIRE_NOISE.has(name)) return "";
  const esc = name.replace(/[$]/g, "\\$&");

  if (lang === "py") {
    const lines = content.split(/\r?\n/);
    const re = new RegExp(`^([ \\t]*)(?:async\\s+)?def\\s+${esc}\\s*\\(`);
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i] ?? "");
      if (!m) continue;
      const base = m[1]!.length;
      const out: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]!;
        if (l.trim() === "") continue;
        if (l.length - l.trimStart().length <= base) break;
        out.push(l);
      }
      return out.join("\n");
    }
    return "";
  }

  if (lang === "go") {
    // A method on the named type — this is how a credential-injecting RoundTripper is found.
    const re = new RegExp(`func\\s*\\(\\s*\\w+\\s+\\*?${esc}\\s*\\)\\s*\\w+\\s*\\(|func\\s+${esc}\\s*\\(`);
    const m = re.exec(content);
    if (!m) return "";
    const open = content.indexOf("{", m.index + m[0].length - 1);
    if (open < 0) return "";
    return content.slice(open, Math.min(matchBrace(content, open) + 1, open + DEF_WINDOW));
  }

  const re = new RegExp(`function\\s*\\*?\\s*${esc}\\s*\\(|(?:const|let|var)\\s+${esc}\\s*(?::[^=\\n]+)?=`);
  const m = re.exec(content);
  if (!m) return "";
  const open = content.indexOf("{", m.index);
  if (open >= 0 && open - m.index < 200)
    return content.slice(open, Math.min(matchBrace(content, open) + 1, open + DEF_WINDOW));
  return content.slice(m.index, m.index + 400);
}

/** The wiring expression plus the bodies of any same-file symbols it names (one hop). */
function withResolvedHandlers(expr: string, content: string, lang: Lang, cache: Map<string, string>): string {
  let text = expr;
  for (const id of [...new Set(expr.match(/[A-Za-z_$][\w$]*/g) ?? [])].slice(0, 8)) {
    const body = definitionBody(id, content, lang, cache);
    if (body) text += "\n" + body;
  }
  return text;
}

interface FileClients {
  /** Symbols constructed as an HTTP client in this file. */
  constructed: Set<string>;
  /** Symbol -> credential attached to it by construction or by a wiring in this file. */
  credentialed: Map<string, CredKind>;
}

/** Ceiling on how much cross-referencing one file may cost. Real client modules need a handful. */
const MAX_SITES = 200;

function clientsIn(content: string, lang: Lang, imported: Set<string>): FileClients {
  const constructed = new Set<string>();
  const credentialed = new Map<string, CredKind>();
  const mods = assignmentsIn(content);
  const defs = new Map<string, string>();
  let budget = MAX_SITES;

  const note = (sym: string, text: string) => {
    if (budget-- <= 0) return;
    const kind = credentialIn(withResolvedHandlers(text, content, lang, defs), mods, mods);
    if (kind === null) return;
    if (credentialed.get(sym) !== "forwarded") credentialed.set(sym, kind);
  };

  const restOfLine = (idx: number): string => {
    const nl = content.indexOf("\n", idx);
    return content.slice(idx, Math.min(nl < 0 ? content.length : nl, idx + ARG_WINDOW));
  };

  for (const { lang: l, re, brace } of CLIENT_CONSTRUCTION) {
    if (l !== lang) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const sym = m[1]!;
      if (WIRE_NOISE.has(sym)) continue;
      constructed.add(sym);
      const open = m.index + m[0].length - 1;
      const text = brace
        ? content.slice(open, Math.min(matchBrace(content, open) + 1, open + ARG_WINDOW))
        : windowedArgs(content, open).join(",");
      note(sym, text);
    }
  }

  const wire = (table: { re: RegExp; args: boolean }[], allowed: (s: string) => boolean) => {
    for (const { re, args } of table) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content))) {
        const sym = m[1]!;
        if (!allowed(sym)) continue;
        if (args) {
          const open = content.indexOf("(", m.index + m[0].length - 1);
          if (open < 0) continue;
          note(sym, windowedArgs(content, open).join(","));
        } else {
          note(sym, restOfLine(m.index));
        }
      }
    }
  };
  wire(STRONG_WIRES, (s) => constructed.has(s) || imported.has(s));
  wire(WEAK_WIRES, (s) => constructed.has(s));

  return { constructed, credentialed };
}

interface ImportBinding {
  local: string;
  /** Resolved module key for JS/Python; the raw import path for Go. */
  module: string;
}

/** Import bindings for ESM, CommonJS `require`, Python `from x import y`, and Go import blocks. */
function importBindings(relPath: string, content: string, lang: Lang): ImportBinding[] {
  const out: ImportBinding[] = [];
  const dir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
  const resolve = (spec: string): string => {
    if (!spec.startsWith(".")) return spec;
    const stack: string[] = [];
    for (const p of (dir + "/" + spec).split("/")) {
      if (p === "." || p === "") continue;
      if (p === "..") stack.pop();
      else stack.push(p);
    }
    return stack.join("/").replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/i, "");
  };

  if (lang === "go") {
    const re = /(?:^|\n)\s*(?:import\s+)?(?:(\w+)\s+)?"([\w./-]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const path = m[2]!;
      out.push({ local: m[1] ?? lastSegment(path), module: path });
    }
    return out;
  }

  const re =
    /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']|from\s+(\.*[\w.]*)\s+import\s+([\w, *]+)|(?:const|let|var)\s+(?:(\w+)|\{([^}]*)\})\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    let spec = m[3] ?? m[8] ?? "";
    if (!spec && m[4]) {
      // Python: `from .client import x` / `from ..pkg.client import x` / `from a.b import x`.
      const dots = /^\.*/.exec(m[4])![0].length;
      const rest = m[4].slice(dots).replace(/\./g, "/");
      spec = dots === 0 ? rest : "./" + "../".repeat(Math.max(0, dots - 1)) + rest;
    }
    if (!spec) continue;
    const module = resolve(spec);
    const single = m[1] ?? m[6];
    if (single) out.push({ local: single, module });
    for (const raw of (m[2] ?? m[5] ?? m[7] ?? "").split(",")) {
      const named = raw
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (named && named !== "*") out.push({ local: named, module });
    }
  }
  return out;
}

function prepassCredentialedClients(ctx: ScanContext): ClientPrepass {
  const names = new Set<string>();
  const modules = new Set<string>();
  const symbols = new Map<string, Set<string>>();

  for (const file of ctx.files) {
    const lang = langOf(file.relPath);
    if (!lang) continue;
    const content = blankComments(file.content, lang);
    if (looksGenerated(content)) continue;
    // A module that strips credentials at its egress boundary, or gates on a destination
    // allow-list, is not lending anyone its authority — do not register its client.
    if (stripsCredentials(content) || hasHostAllowlist(content)) continue;

    const bindings = importBindings(file.relPath, content, lang);
    const importedLocal = new Map(bindings.map((b) => [b.local, b.module]));
    const { constructed, credentialed } = clientsIn(content, lang, new Set(importedLocal.keys()));

    for (const [sym] of credentialed) {
      // Credit the module that constructs the client, not the one that decorates it: a caller
      // imports the client from where it is created.
      const home = constructed.has(sym)
        ? moduleKeyOf(file.relPath, lang)
        : (importedLocal.get(sym) ?? moduleKeyOf(file.relPath, lang));
      modules.add(home);
      if (!symbols.has(home)) symbols.set(home, new Set());
      symbols.get(home)!.add(sym);
      if (lang !== "go") names.add(sym);
    }
  }
  return { names, modules, symbols };
}

/** Local names bound to an import from a module known to export a credentialed client. */
function importedCredentialedNames(file: ScanFile, content: string, lang: Lang, pre: ClientPrepass): Set<string> {
  const out = new Set<string>();
  if (lang === "go") return out;
  for (const b of importBindings(file.relPath, content, lang)) {
    if (pre.modules.has(b.module)) out.add(b.local);
  }
  return out;
}

/**
 * Go has no per-symbol import: `httpclient.Client.Get(url)` reaches a package-level client by
 * package name. Map each imported package alias to the credentialed client symbols of the
 * package directory it resolves to.
 */
function goQualifiedCredentials(file: ScanFile, content: string, pre: ClientPrepass): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const b of importBindings(file.relPath, content, "go")) {
    const tail = lastSegment(b.module);
    for (const [key, syms] of pre.symbols) {
      if (lastSegment(key) !== tail) continue;
      const bucket = out.get(b.local) ?? new Set<string>();
      syms.forEach((s) => bucket.add(s));
      out.set(b.local, bucket);
    }
  }
  return out;
}

/* ── Outbound call sites ─────────────────────────────────────────────────────────────── */

interface CallSite {
  index: number;
  urlExpr: string;
  optionsText: string;
  receiver: string | null;
  /** The package/namespace in front of the receiver, as in Go's `httpclient.Client.Get(...)`. */
  qualifier: string | null;
  /** Character range of this call's argument list, used to attribute credentials to it. */
  argStart: number;
  argEnd: number;
}

const HTTP_LIB =
  /(\bfetch\s*\()|(\baxios\b)|(\bhttpx\b)|(\brequests\b)|(\baiohttp\b)|(net\/http)|(\bgot\s*\()|(\bky\b)|(superagent)|(urllib)|(node-fetch)|(undici)|(http\.Client)/;
/** JVM HTTP clients. Kept out of `HTTP_LIB` so a JS `WebClient` (Slack) never enables this pass. */
const JAVA_HTTP_LIB =
  /(\bHttpClient\b)|(\bHttpRequest\b)|(\bRestTemplate\b)|(\bWebClient\b)|(\bOkHttpClient\b)|(\bHttpURLConnection\b)|(\bURI\s*\.\s*create\s*\()/;

function findCallSites(content: string, lang: Lang, allowGeneric: boolean): CallSite[] {
  const sites: CallSite[] = [];
  const push = (
    index: number,
    urlExpr: string,
    rest: string[],
    receiver: string | null,
    range: [number, number],
    qualifier: string | null = null,
  ) => {
    if (urlExpr.trim() === "") return;
    sites.push({
      index,
      urlExpr,
      optionsText: rest.join(","),
      receiver,
      qualifier,
      argStart: range[0],
      argEnd: range[1],
    });
  };

  // Direct forms whose URL is the first argument.
  const first =
    /\b(?:fetch|got|ky|superagent|request)\s*\(|(?:axios|http|https|requests|httpx|session|client)\s*\.\s*(?:get|post|put|patch|delete|head|options|request)\s*\(|urllib\.request\.Request\s*\(|http\.(?:Get|Post|PostForm|Head)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = first.exec(content))) {
    const open = content.indexOf("(", m.index + m[0].length - 1);
    const { args, end } = splitArgs(content, open);
    push(m.index, args[0] ?? "", args.slice(1), null, [open, end]);
  }

  // Generic `receiver.verb(` — only when the file actually uses an HTTP client, so DB and
  // SDK calls with the same verb names are not mistaken for outbound requests.
  if (allowGeneric) {
    // The optional leading group is the package qualifier: `httpclient.Client.Get(url)`.
    const generic = /\b(?:(\w+)\s*\.\s*)?(\w+)\s*\.\s*(get|post|put|patch|delete|head|options|request)\s*\(/gi;
    while ((m = generic.exec(content))) {
      const open = content.indexOf("(", m.index + m[0].length - 1);
      const { args, end } = splitArgs(content, open);
      push(m.index, args[0] ?? "", args.slice(1), m[2] ?? null, [open, end], m[1] ?? null);
    }
  }

  if (lang === "go") {
    const goReq = /http\.NewRequest(WithContext)?\s*\(/g;
    while ((m = goReq.exec(content))) {
      const open = content.indexOf("(", m.index + m[0].length - 1);
      const { args, end } = splitArgs(content, open);
      const urlIdx = m[1] ? 2 : 1; // (ctx, method, url, body) vs (method, url, body)
      push(m.index, args[urlIdx] ?? "", args, null, [open, end]);
    }
  }

  if (lang === "java") {
    /* Java names the request target in a constructor or a builder rather than passing it to a
       verb method: `HttpRequest.newBuilder(uri)`, `URI.create(s)`, `new URL(s)`, OkHttp/WebClient
       `.url(s)` / `.uri(s)`, RestTemplate `getForObject(url, ...)`. The credential is then
       attached by a chained `.header(...)` that sits OUTSIDE this argument list, which is exactly
       why the argument range is recorded. */
    const target =
      /\b(?:URI\s*\.\s*create|HttpRequest\s*\.\s*newBuilder|new\s+URI|new\s+URL|new\s+HttpGet|new\s+HttpPost)\s*\(|\.\s*(?:uri|url)\s*\(|\.\s*(?:getForObject|getForEntity|postForObject|postForEntity|exchange)\s*\(/g;
    while ((m = target.exec(content))) {
      const open = content.indexOf("(", m.index + m[0].length - 1);
      const { args, end } = splitArgs(content, open);
      push(m.index, args[0] ?? "", args.slice(1), null, [open, end]);
    }
  }

  // `axios({ url })` / `axios.request({ url })` object form.
  const objForm = /\b(\w+)\s*(?:\.\s*request\s*)?\(\s*\{/g;
  while ((m = objForm.exec(content))) {
    if (!/^(axios|client|http|api|instance|request)$/i.test(m[1] ?? "")) continue;
    const open = content.indexOf("{", m.index);
    const close = matchBrace(content, open);
    const block = content.slice(open, close + 1);
    const u = /\burl\s*:\s*([^,\n}]+)/.exec(block);
    if (u) push(m.index, u[1]!, [block], m[1] ?? null, [open, close]);
  }

  return sites;
}

/**
 * Blank the argument lists of every outbound call, preserving offsets.
 *
 * A credential written inside one call's arguments belongs to THAT call. Reading it as a
 * property of the enclosing function is what makes a link-preview handler — an uncredentialed
 * `fetch(userUrl, …)` next to a credentialed `fetch(OUR_API, …)` — look like a confused deputy
 * when the two are never combined. Credentials attached outside any call (a Go `req.Header.Set`,
 * a shared `headers` object, a Java builder's chained `.header(...)`) still count, because those
 * really do apply to the request being built.
 */
function maskCallArguments(content: string, sites: CallSite[]): string {
  if (sites.length === 0) return content;
  const out = content.split("");
  for (const s of sites) {
    for (let i = Math.max(0, s.argStart); i <= Math.min(s.argEnd, out.length - 1); i++) {
      if (out[i] !== "\n") out[i] = " ";
    }
  }
  return out.join("");
}

function surfaceOf(file: ScanFile): Surface {
  if (file.surfaces.includes("mcp_server")) return "mcp_server";
  if (file.surfaces.includes("agent_code")) return "agent_code";
  return "app_code";
}

export const confusedDeputyDetector: Detector = {
  classIds: ["confused-deputy"],
  tier: "research",
  run(ctx: ScanContext): DetectorFinding[] {
    const findings: DetectorFinding[] = [];
    const pre = prepassCredentialedClients(ctx);

    for (const file of ctx.files) {
      const lang = langOf(file.relPath);
      if (!lang) continue;
      const content = blankComments(file.content, lang);
      /* Minified build output. `buildScanContext` ingests `dist/` on purpose — a shipped bundle
         is a real surface for a leaked secret — but this detector needs the *structure* around a
         call (which client, which scope, which guard) and none of it survives bundling. The
         several whitespace-tolerant gate regexes below are also quadratic against an
         80,000-character line, which is minutes on a Next.js build. */
      if (looksGenerated(content)) continue;
      const importedCreds = importedCredentialedNames(file, content, lang, pre);
      const qualifiedCreds =
        lang === "go" ? goQualifiedCredentials(file, content, pre) : new Map<string, Set<string>>();
      /* Clients declared in this same module/package are reachable without an import. */
      const localCreds = pre.symbols.get(moduleKeyOf(file.relPath, lang)) ?? new Set<string>();
      /* Bare receiver names that carry a credential. The repo-wide `pre.names` fallback is kept
         for JS/Python, where it has always been how a client decorated in a third module is
         recognised; Go resolves by package instead, so a generic `Client` in one package never
         credentials a `Client` in another. */
      const bareCreds = new Set<string>([...importedCreds, ...localCreds]);
      if (lang !== "go") pre.names.forEach((n) => bareCreds.add(n));
      /* A call site whose client was built — and credentialed — in another module may name no
         HTTP library at all in this file. Recognising the client by name is what keeps that
         file in scope; gating purely on a local `fetch`/`axios` import would skip it. */
      const usesKnownClient = [...bareCreds, ...[...qualifiedCreds.values()].flatMap((s) => [...s])].some(
        (n) =>
          /^[A-Za-z_$][\w$]*$/.test(n) &&
          new RegExp(`\\b${n}\\s*\\.\\s*(?:get|post|put|patch|delete|head|options|request)\\s*\\(`, "i").test(content),
      );
      const httpish =
        HTTP_LIB.test(content) ||
        /http\.NewRequest/.test(content) ||
        (lang === "java" && JAVA_HTTP_LIB.test(content)) ||
        usesKnownClient;
      if (!httpish) continue;

      // An allow-list or an egress credential strip governs the whole file's outbound edges.
      if (hasHostAllowlist(content) || stripsCredentials(content)) continue;

      const mods = assignmentsIn(content);
      const scopes = extractScopes(content, lang);
      const moduleScope: Scope = { name: "(module)", start: 0, end: content.length, text: content };
      const reported = new Set<number>();
      /* Every call site in a scope reads the same two facts from it. Recomputing them per site is
         quadratic in the scope's size, which a build artifact makes painful. */
      const sites = findCallSites(content, lang, httpish);
      /* Credentials that belong to some *other* call's arguments are not this scope's ambient
         authority — see `maskCallArguments`. */
      const shared = maskCallArguments(content, sites);
      const analysed = new Map<Scope, { locals: Map<string, string>; cred: CredKind }>();
      const analyse = (scope: Scope) => {
        let a = analysed.get(scope);
        if (!a) {
          const locals = assignmentsIn(scope.text);
          a = { locals, cred: credentialIn(shared.slice(scope.start, scope.end + 1), locals, mods) };
          analysed.set(scope, a);
        }
        return a;
      };

      for (const site of sites) {
        const scope = scopeAt(scopes, site.index, moduleScope);
        const { locals, cred } = analyse(scope);

        // 1. Destination — pinned origin is not a confused deputy, however dynamic the path.
        if (originIsFixed(site.urlExpr, locals, mods)) continue;

        // 2. Credential — at the call site, in the enclosing scope, or on the client itself.
        let kind = credentialIn(site.optionsText, locals, mods) ?? cred;
        let inherited = false;
        if (kind === null && site.receiver !== null) {
          const viaQualifier =
            site.qualifier !== null && (qualifiedCreds.get(site.qualifier)?.has(site.receiver) ?? false);
          if (bareCreds.has(site.receiver) || viaQualifier) {
            kind = "service";
            inherited = true;
          }
        }
        if (kind === null) continue;
        /* An ambient client credential is not the server's authority on loan when the caller has
           already exchanged its own token for a caller-scoped one — that call carries the
           caller's authority, whatever the client would otherwise attach. */
        if (inherited && DELEGATED.test(scope.text)) continue;

        const line = lineOf(content, site.index);
        if (reported.has(line)) continue;
        reported.add(line);

        const reason =
          kind === "forwarded"
            ? "forwards the caller's own bearer credential to a destination the caller chooses, so any host " +
              "the caller names receives a usable token"
            : "attaches this service's own privileged credential to a request whose destination the caller " +
              "controls, so the caller borrows the server's authority";
        findings.push({
          tier: "research",
          classId: "confused-deputy",
          severity: "high",
          surfaces: file.surfaces,
          locations: [{ path: file.relPath, startLine: line, endLine: line, surface: surfaceOf(file) }],
          explanation:
            `${file.relPath}:${line} ${reason}. The destination expression \`${site.urlExpr.trim().slice(0, 80)}\` ` +
            `is not pinned to a literal origin. Validate the destination host against an allow-list before the ` +
            `credential is attached, exchange the caller's token for a caller-scoped one instead of sending the ` +
            `service credential, or strip credentials at the egress boundary.`,
          confidence: kind === "forwarded" ? 0.68 : 0.66,
        });
      }
    }

    return findings;
  },
};
