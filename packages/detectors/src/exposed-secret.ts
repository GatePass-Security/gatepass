import type { Detector, DetectorFinding, ScanContext, ScanFile } from "@gatepass/engine";
import type { Severity } from "@gatepass/findings";
import { redactSecrets } from "@gatepass/findings";

/**
 * Verified detector: a live credential committed to the repository or shipped to clients.
 *
 * Two things decide a finding, and they are deliberately separate:
 *
 *  1. Does the text carry a credential? Three families, because credentials are not only
 *     issuer-prefixed API keys:
 *       - issuer-formatted tokens (AWS, Stripe, GitHub, npm, Slack, Google, Anthropic, …),
 *         which are self-identifying by construction;
 *       - key material (a PEM private key block, including one inlined into a JSON
 *         service-account file as an escaped `\n` string);
 *       - credentials carried structurally rather than as a token — URL userinfo, which is
 *         how a registry token ends up in a lockfile `resolved` URL and how a database
 *         password ends up in a committed DSN.
 *
 *  2. Is this a *credential*, or a picture of one? Placeholders, examples and fixtures are
 *     credential-shaped on purpose, so the discriminator cannot be the string — the same
 *     `AKIA…EXAMPLE` literal is documentation in `docs/`, a template in `.env.example`, a
 *     fixture in a redaction test, and a genuine leak in `dist/bundle.js`. Context decides:
 *     documentation, example/template files and test trees are excluded as a whole, and
 *     within real code an env lookup (`process.env.X`, `${{ secrets.X }}`, `${VAR}`) is a
 *     reference to a secret, not a secret.
 *
 * Coverage follows where credentials actually leak rather than where source lives:
 * lockfiles, committed `.env` files, CI workflow YAML, Dockerfiles, JSON config and built
 * bundles are all in scope.
 */

interface SecretHit {
  index: number;
  value: string;
  what: string;
  severity: Severity;
}

/* ── issuer-formatted tokens ────────────────────────────────────────────────────────── */

interface SecretPattern {
  name: string;
  regex: RegExp;
  severity: Severity;
}

const PATTERNS: SecretPattern[] = [
  { name: "AWS access key id", regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, severity: "critical" },
  { name: "Anthropic API key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, severity: "critical" },
  { name: "OpenAI API key", regex: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g, severity: "critical" },
  { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: "high" },
  /* Structured, not just prefixed. A Slack token's second segment is the numeric team/app id,
     always at least nine digits — `xoxb-<digits>-<opaque>`. Matching `xox?-` plus "some
     characters" also matches the redaction *patterns* and mock values that carry the prefix
     with no id (`xoxb-test-token`, `xox[baprs]-[A-Za-z0-9-]{10,}` inside a scrubber), none of
     which is a credential. The issuer's own format is the discriminator. */
  { name: "Slack token", regex: /\bxox[baprse]-\d{9,}-[0-9A-Za-z-]{8,}\b/g, severity: "high" },
  {
    name: "Slack webhook URL",
    regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/+_-]{20,}/g,
    severity: "high",
  },
  // Stripe: `sk_live_`/`rk_live_` are account-level API keys; `whsec_` signs webhooks.
  { name: "Stripe live secret key", regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{10,}\b/g, severity: "critical" },
  { name: "Stripe webhook signing secret", regex: /\bwhsec_[A-Za-z0-9]{16,}\b/g, severity: "high" },
  { name: "GitHub token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, severity: "critical" },
  { name: "GitHub fine-grained token", regex: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, severity: "critical" },
  { name: "npm registry token", regex: /\bnpm_[A-Za-z0-9]{24,}\b/g, severity: "high" },
  { name: "SendGrid API key", regex: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{30,}\b/g, severity: "high" },
  { name: "Azure storage account key", regex: /AccountKey=[A-Za-z0-9+/]{40,}={0,2}/g, severity: "critical" },
];

/* ── private key blocks: the delimiter is not the secret ────────────────────────────── */

/**
 * `-----BEGIN PRIVATE KEY-----` is a *delimiter*. On its own it is a format string, and it is
 * written far more often than a key is leaked: as the placeholder in a credential input field
 * ("Begins with -----BEGIN RSA PRIVATE KEY-----"), as the argument to a `startsWith` format
 * check, and as the header of a deliberately-invalid value in a parser test. Matching the
 * header alone reports all three.
 *
 * The credential is the base64 body between BEGIN and END, so that is what is required: at
 * least `PEM_MIN_BODY` characters of contiguous base64. The shortest real key body — an
 * Ed25519 OpenSSH key — is comfortably over 100 characters, while a stand-in body is prose
 * (`not-a-valid-key`) or absent entirely, and prose is not base64.
 *
 * Escaped `\n` is unescaped first: a private key inlined into a JSON service-account file or
 * a `.env` is one physical line whose newlines are two-character escapes. RFC 1421 headers
 * (`Proc-Type:`, `DEK-Info:`) that precede an encrypted body are dropped rather than treated
 * as non-base64 noise, so an encrypted key is still recognised.
 */
const PEM_BEGIN = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;
const PEM_MIN_BODY = 64;

function pemMaterial(body: string): string {
  return body
    .replace(/\\+[rn]/g, "\n") // JSON/env-escaped newlines
    .replace(/^[ \t]*[A-Za-z][A-Za-z-]*:.*$/gm, "") // RFC 1421 headers on an encrypted key
    .replace(/["'`,+\\]/g, "") // string-concatenation scaffolding
    .replace(/\s+/g, "");
}

function findPrivateKeyBlocks(content: string): SecretHit[] {
  const out: SecretHit[] = [];
  PEM_BEGIN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PEM_BEGIN.exec(content)) !== null) {
    const from = m.index + m[0].length;
    const end = content.indexOf("-----END", from);
    const body = content.slice(from, end >= 0 ? end : Math.min(content.length, from + 8192));
    const material = pemMaterial(body);
    if (material.length < PEM_MIN_BODY || !/^[A-Za-z0-9+/=]+$/.test(material)) continue;
    out.push({
      index: m.index,
      value: m[0],
      what: "a private key block carrying real base64 key material",
      severity: "critical",
    });
  }
  return out;
}

/* ── context: what is a credential here, and what is a picture of one ───────────────── */

/** Documentation shows credentials on purpose; the example values are the point. */
const DOC_LIKE = /(^|\/)(docs?|examples?|samples?)\/|\.(md|mdx|rst|adoc|txt)$|(^|\/)(readme|changelog|contributing)/i;

/** Templates exist to be copied and filled in — their values are placeholders by definition. */
const TEMPLATE_LIKE =
  /(^|\/)\.env\.(example|sample|template|dist|defaults?)$|\.(example|sample|template|tpl|dist)(\.[a-z]+)?$|(^|\/)env\.(example|sample|template)$/i;

/** A credential-shaped literal in a test is a fixture — often one asserting redaction works. */
const TEST_LIKE =
  /(^|\/)(tests?|spec|specs|__tests__|__mocks__|__fixtures__|fixtures?|testdata|e2e|mocks?)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go|rb)$|(^|\/)conftest\.py$/i;

/** A shipped artifact: the value is served to every visitor, not merely committed. */
const BUNDLE = /\.(js|mjs|cjs|map|css)$/i;
const BUILD_DIR = /(^|\/)(dist|build|out|public|static|\.next|\.output|\.svelte-kit)\//i;

/**
 * An inline placeholder: templating syntax or a self-describing stand-in. `EXAMPLE` is
 * deliberately NOT here — AWS's published example key is a placeholder in documentation and
 * a real finding when it is baked into a shipped bundle, so that call is made by file
 * context above, not by the string.
 *
 * The second line is the *self-negating* value: a string that states in words that it is not
 * a credential — `not-a-real-password`, `fake-token`, `dummy_secret`, `REDACTED`. This is a
 * property of the value, not of where it sits: a real credential is opaque randomness issued
 * by a provider, and randomness does not spell English claims about itself. Requiring word
 * boundaries is what keeps it from firing inside issuer-formatted tokens, whose alphabets
 * cannot produce one (`AKIAFAKE…` has no boundary before `FAKE`), so an actual key that
 * happens to contain those letters is unaffected.
 */
const PLACEHOLDER_VALUE =
  /\$\{|\{\{|\$\(|<[A-Za-z_ ]+>|\byour[_-]?|\bplaceholder\b|\breplace[_-]?me\b|\bchange[_-]?me\b|\binsert[_-]?|x{8,}|\.{3}|\bnot[_-]?an?[_-]?(?:real|valid|actual|live|prod|production|secret|key|token|password)\b|\b(?:fake|dummy|bogus|redacted|scrubbed|sanitized|obfuscated)\b|\bdo[_-]?not[_-]?use\b/i;

/** A reference to a secret store is the correct pattern, not a leak. */
const ENV_REFERENCE =
  /process\.env\b|os\.environ|os\.getenv|ENV\[|\$\{\{\s*secrets\.|\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]{2,}|System\.getenv|Deno\.env|vault:|secretsmanager|from_service_account_file/i;

function skipFile(file: ScanFile): boolean {
  const p = file.relPath;
  return DOC_LIKE.test(p) || TEMPLATE_LIKE.test(p) || TEST_LIKE.test(p);
}

/* ── credentials carried in URL userinfo ────────────────────────────────────────────── */

/**
 * `scheme://user:password@host` — the shape that puts a private-registry token into a
 * lockfile `resolved` URL and a database password into a committed DSN. Interpolated
 * userinfo is a template, not a value, and well-known local development defaults
 * (`postgres:postgres@db`) are not credentials worth rotating.
 */
const URL_USERINFO =
  /\b([a-z][a-z0-9+.-]{1,15}):\/\/([^\s/:@'"`<>]{1,256}):([^\s/@'"`<>]{0,256})@([^\s/'"`<>,]{1,256})/gi;
const INTERPOLATED = /[$`{}%+<>]/;
const DEV_DEFAULT_PASSWORD =
  /^(postgres|postgresql|mysql|mariadb|redis|mongo|root|admin|administrator|password|passwd|pass|secret|changeme|example|test|testing|guest|user|dev|local|docker|none|null|123456|abc123|letmein)$/i;

function findUserinfoCredentials(content: string): SecretHit[] {
  const out: SecretHit[] = [];
  URL_USERINFO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_USERINFO.exec(content)) !== null) {
    const [, scheme, user, pass, host] = m as unknown as [string, string, string, string, string];
    if (INTERPOLATED.test(user) || INTERPOLATED.test(pass)) continue; // a template, not a value

    if (pass === "") {
      /* `https://<token>:@registry/…` — the token is the username and the password is
         empty. Only a long opaque username is a credential; `git://github.com/…` is not. */
      const opaque = user.length >= 16 && /[0-9_]/.test(user) && !user.includes(".");
      if (!opaque) continue;
      out.push({
        index: m.index,
        value: user,
        what: `a registry auth token embedded in a ${scheme}:// URL for ${host}`,
        severity: "high",
      });
      continue;
    }

    if (pass.length < 6 || DEV_DEFAULT_PASSWORD.test(pass)) continue;
    if (PLACEHOLDER_VALUE.test(pass)) continue;
    out.push({
      index: m.index,
      value: pass,
      what: `a password inlined into a ${scheme}:// connection string for ${host}`,
      severity: "high",
    });
  }
  return out;
}

/* ── credentials assigned as literals in configuration ──────────────────────────────── */

/**
 * Config files are where a literal *is* the credential: an `.env` that was committed, a CI
 * job that hardcodes a key into `env:`, a Dockerfile `ENV`. This rule is confined to those
 * files on purpose — in application source, a `password` identifier almost always holds a
 * lookup, and flagging it is the classic false positive.
 */
const CONFIG_SECRET_FILE =
  /(^|\/)\.env(\.[a-z0-9_-]+)?$|(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)\.circleci\/|azure-pipelines.*\.ya?ml$|(^|\/)docker-compose[\w.-]*\.ya?ml$|(^|\/)[Dd]ockerfile[\w.-]*$|(^|\/)\.npmrc$/;

const SECRET_KEY_NAME =
  /(?:^|[_\-.])(?:api[_-]?keys?|secrets?|tokens?|passwords?|passwd|pwd|private[_-]?keys?|access[_-]?keys?|secret[_-]?keys?|client[_-]?secrets?|auth[_-]?tokens?|signing[_-]?keys?|encryption[_-]?keys?|credentials?|dsn)$/i;

function looksLikeCredentialValue(value: string): boolean {
  if (value.length < 12 || value.length > 512) return false;
  if (/\s/.test(value)) return false;
  if (PLACEHOLDER_VALUE.test(value) || ENV_REFERENCE.test(value)) return false;
  if (/^(true|false|null|none|undefined)$/i.test(value)) return false;
  if (/^\d+$/.test(value)) return false;
  if (/^[./~]/.test(value) || /\.(json|pem|key|crt|txt|ya?ml)$/i.test(value)) return false; // a path
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(value)).length;
  return classes >= 2;
}

function findConfigSecrets(file: ScanFile): SecretHit[] {
  if (!CONFIG_SECRET_FILE.test(file.relPath)) return [];
  const out: SecretHit[] = [];
  const lines = file.content.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    const start = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    const m = /^(?:(?:ENV|ARG|export)\s+)?["']?([A-Za-z_][\w.-]*)["']?\s*[:=]\s*["']?([^"'\n]*?)["']?\s*$/.exec(
      trimmed,
    );
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.trim();
    if (!SECRET_KEY_NAME.test(key)) continue;
    if (!looksLikeCredentialValue(value)) continue;
    out.push({
      index: start + line.indexOf(value),
      value,
      what: `a literal credential assigned to \`${key}\``,
      severity: "high",
    });
  }
  return out;
}

/* ── detector ───────────────────────────────────────────────────────────────────────── */

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

const MAX_PER_FILE = 20;

export const exposedSecretDetector: Detector = {
  classIds: ["exposed-secret"],
  tier: "verified",
  run(ctx: ScanContext): DetectorFinding[] {
    const findings: DetectorFinding[] = [];

    for (const file of ctx.files) {
      if (skipFile(file)) continue;
      const isBundle = BUNDLE.test(file.relPath) && BUILD_DIR.test(file.relPath);
      const hits: SecretHit[] = [];

      // A Google service-account key file: the credential is the inlined PEM.
      if (
        /"type"\s*:\s*"service_account"/.test(file.content) &&
        /"private_key"\s*:\s*"[^"]*BEGIN [A-Z ]*PRIVATE KEY/.test(file.content)
      ) {
        const idx = file.content.indexOf('"private_key"');
        hits.push({
          index: idx,
          value: (/"private_key"\s*:\s*"([^"]{0,120})/.exec(file.content)?.[1] ?? "private_key").slice(0, 120),
          what: "a Google service-account key with the RSA private key inlined",
          severity: "critical",
        });
      }

      for (const pattern of PATTERNS) {
        pattern.regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.regex.exec(file.content)) !== null) {
          if (PLACEHOLDER_VALUE.test(m[0])) continue;
          hits.push({ index: m.index, value: m[0], what: `a ${pattern.name}`, severity: pattern.severity });
        }
      }

      hits.push(...findPrivateKeyBlocks(file.content));
      hits.push(...findUserinfoCredentials(file.content));
      hits.push(...findConfigSecrets(file));

      const seen = new Set<number>();
      for (const hit of hits.sort((a, b) => a.index - b.index).slice(0, MAX_PER_FILE)) {
        const line = lineOf(file.content, hit.index);
        if (seen.has(line)) continue;
        seen.add(line);

        const severity: Severity = isBundle ? "critical" : hit.severity;
        const where = isBundle ? "a shipped client bundle" : "a committed file";
        const steps = [
          `Open ${file.relPath} and go to line ${line}.`,
          `Observe ${hit.what}.`,
          `Value (redacted): ${redactSecrets(hit.value, [hit.value])}`,
          isBundle
            ? `Load the bundle in a browser and read the same value out of the served asset.`
            : `Check the repository history — the value is readable to everyone with repo access and must be rotated, not just deleted.`,
        ].map((s) => redactSecrets(s, [hit.value]));

        findings.push({
          tier: "verified",
          classId: "exposed-secret",
          severity,
          surfaces: file.surfaces,
          locations: [{ path: file.relPath, startLine: line, endLine: line, surface: file.surfaces[0]! }],
          explanation:
            `${file.relPath}:${line} contains ${hit.what} in ${where}. ` +
            (isBundle
              ? "This value is served to every client that loads the bundle."
              : "This value is committed to the repository and is readable by anyone with repo access."),
          reproduction: { kind: "inspection", steps, expected: `A usable credential is present in ${where}.` },
          rawSecrets: [hit.value],
        });
      }
    }

    return findings;
  },
};
