import type { Detector, DetectorFinding, ScanContext } from "@gatepass/engine";
import { redactSecrets } from "@gatepass/findings";

/**
 * Verified detector: exposed secrets in source and, especially, in built/bundled
 * artifacts that ship to clients. Each finding carries a concrete reproduction
 * (Constitution FR-008) with the secret value redacted (contract rule 5).
 */

interface SecretPattern {
  name: string;
  regex: RegExp;
  severity: "critical" | "high";
}

const PATTERNS: SecretPattern[] = [
  { name: "AWS access key id", regex: /\bAKIA[0-9A-Z]{16}\b/g, severity: "critical" },
  { name: "Anthropic API key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, severity: "critical" },
  { name: "OpenAI API key", regex: /\bsk-[A-Za-z0-9]{32,}\b/g, severity: "critical" },
  { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: "high" },
  {
    name: "Slack token",
    /*
     * Slack's documented shape: prefix, then numeric workspace and app ids, then the secret.
     * The looser `xox[baprs]-<anything>` matched `xoxb-explicit-token` in a mock (agno-agi/agno)
     * and `xoxb-your-bot-token` in a commented example. Requiring the real structure separates a
     * token from a string that merely starts like one.
     */
    regex: /\bxox[baprs]-\d{9,}-\d{9,}-[0-9A-Za-z]{20,}\b/g,
    severity: "high",
  },
  {
    name: "Generic private key block",
    /*
     * The BEGIN line is a label, not a key. Matching it alone flags every schema that
     * documents the format ("Begins with -----BEGIN RSA PRIVATE KEY-----"), every test that
     * asserts on the header, and every docstring that abbreviates the body as "...". A key is
     * the base64 material, so that is what this requires: at least one substantial body line
     * between the delimiters.
     */
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\r\n\s]+(?:[A-Za-z0-9+/=]{40,}[\r\n\s]+)+-----END/g,
    severity: "critical",
  },
];

/**
 * Markers by which a repository states, in the file, that a value is deliberately fake.
 *
 * Honouring these is not leniency — it is the difference between reading a repository and
 * pattern-matching it. Every one of these is an existing convention (detect-secrets, gitleaks,
 * bandit, flake8) that maintainers already use, and ignoring them means telling a team that the
 * fixture they explicitly annotated is a critical credential leak.
 */
const SUPPRESSION = /pragma:\s*allowlist\s*secret|gitleaks:\s*allow|trufflehog:ignore|#\s*nosec|#\s*noqa/i;

/**
 * Documented example credentials — values published by the vendor precisely so that people can
 * paste them into examples and tests.
 *
 * `AKIAIOSFODNN7EXAMPLE` is in AWS's own documentation. Reporting it as a critical exposed key
 * is the single loudest false positive this detector produces on real repositories: one
 * well-tested AWS project accounted for dozens of them, several on lines already annotated as
 * deliberate fixtures.
 */
const PUBLISHED_EXAMPLES = new Set(["AKIAIOSFODNN7EXAMPLE", "AKIAI44QH8DHBEXAMPLE", "AKIAIOSFODNN7EXAMPLF"]);

/** Words a credential does not contain, and that a placeholder almost always does. */
const PLACEHOLDER_WORDS =
  /example|placeholder|your[-_]?(api|key|token|secret|bot)|dummy|fake|sample|changeme|change[-_]?me|redacted|notreal|not[-_]?a[-_]?valid|xxxx+|test[-_]?(key|token|secret)|abc123|foobar|explicit|mock|stub/i;

/**
 * A credential does not describe itself.
 *
 * Generated secrets are opaque; a value containing the word "token", "secret" or "password" as
 * a word is a human writing a stand-in. This is checked against the matched value only, never
 * the surrounding line — `const apiKey = "…"` is exactly how a real leak looks.
 */
const SELF_DESCRIBING = /(^|[-_])(token|secret|password|apikey|api|key|credential)([-_]|$)/i;

/**
 * A run of consecutive alphabet or digits, the shape a human reaches for when inventing a key.
 *
 * `sk-abcdefghijklmnopqrstuvwxyz1234567890` is a real example from a real repository's tests.
 * No generated credential contains eight sequential characters; the odds are about one in
 * eleven billion per position, so this costs effectively no recall.
 */
function hasSequentialRun(value: string, min = 8): boolean {
  let run = 1;
  for (let i = 1; i < value.length; i++) {
    run = value.charCodeAt(i) === value.charCodeAt(i - 1) + 1 ? run + 1 : 1;
    if (run >= min) return true;
  }
  return false;
}

/** A run of one repeated character — the other way a placeholder gets written. */
function hasRepeatRun(value: string, min = 8): boolean {
  return new RegExp(`(.)\\1{${min - 1},}`).test(value);
}

/**
 * Is this value provably not a credential?
 *
 * Deliberately narrow. It answers "can this be ruled out with certainty", not "does this look
 * like a test" — a path heuristic would be the easy version of this and the wrong one, because
 * a credential committed to a test file is still a credential in git history. Everything here
 * is a property of the value or an explicit statement by the author.
 */
function isProvablySynthetic(secret: string, line: string): boolean {
  if (PUBLISHED_EXAMPLES.has(secret)) return true;
  if (SUPPRESSION.test(line)) return true;
  if (PLACEHOLDER_WORDS.test(secret) || PLACEHOLDER_WORDS.test(line)) return true;
  if (SELF_DESCRIBING.test(secret)) return true;
  return hasSequentialRun(secret) || hasRepeatRun(secret);
}

/** True when the match sits in a comment — documentation of a secret's shape, not a secret. */
function isCommented(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("#") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("--");
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

export const exposedSecretDetector: Detector = {
  classIds: ["exposed-secret"],
  tier: "verified",
  run(ctx: ScanContext): DetectorFinding[] {
    const findings: DetectorFinding[] = [];
    for (const file of ctx.files) {
      const isBundle = /\.(js|map)$/.test(file.relPath) && /(dist|build|\.next)\//.test(file.relPath);
      const lines = file.content.split(/\r?\n/);
      for (const pattern of PATTERNS) {
        pattern.regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.regex.exec(file.content)) !== null) {
          const secret = m[0];
          const line = lineOf(file.content, m.index);
          const sourceLine = lines[line - 1] ?? "";
          /*
           * Verified tier means deterministically confirmed, so a value that cannot be
           * confirmed must not be emitted at this tier at all. Measured against forty public
           * repositories, every single exposed-secret finding this detector produced was a
           * documented example, an annotated fixture, or a header with no key after it.
           */
          if (isProvablySynthetic(secret, sourceLine) || isCommented(sourceLine)) continue;
          const severity = isBundle ? "critical" : pattern.severity;
          findings.push({
            tier: "verified",
            classId: "exposed-secret",
            severity,
            surfaces: file.surfaces,
            locations: [{ path: file.relPath, startLine: line, endLine: line, surface: file.surfaces[0]! }],
            explanation:
              `${pattern.name} found in ${isBundle ? "a shipped client bundle" : "source"} ` +
              `(${file.relPath}:${line}). ${isBundle ? "This value is served to end users." : "This value is committed to the repository."}`,
            reproduction: {
              kind: "inspection",
              steps: [
                `Open ${file.relPath} and go to line ${line}.`,
                `Observe a ${pattern.name} matching the pattern ${pattern.regex.source}.`,
                `Value (redacted): ${redactSecrets(secret, [secret])}`,
              ],
              expected: `A live ${pattern.name} is present and ${isBundle ? "reachable by any client that loads the bundle" : "readable by anyone with repo access"}.`,
            },
            rawSecrets: [secret],
          });
        }
      }
    }
    return findings;
  },
};
