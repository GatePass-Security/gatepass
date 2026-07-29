import { anchorLines, isCrossSurface, type Finding, type FixEdit } from "@gatepass/findings";

/**
 * Builds the PR review payload (FR-012). One review per scan, per-finding comments with a
 * tier badge and — where an applicable fix exists — a GitHub ```suggestion``` block. This
 * module only SHAPES the review; posting it goes through the audited writer (Principle III).
 * It never mutates code.
 *
 * ## Why this module needs the head source
 *
 * A GitHub ```suggestion``` block REPLACES the lines its comment is anchored to. Gatepass's
 * fix edits are insertions (`operation: "insert_after"`), because the findings document
 * deliberately carries no copy of the customer's source — so `insertedLines` on its own is
 * *not* a valid suggestion body. Fencing it as one would tell GitHub to replace the
 * developer's line with the addition: a single click would delete their code.
 *
 * The anchor text therefore has to come from somewhere, and it comes from the workspace the
 * scan just ran over. `buildReview` takes an optional `source` and reads the anchor lines
 * back out of it. The webhook path holds that workspace open across the scan and the
 * delivery, so this is a lookup rather than a fetch.
 *
 * When no source is available — or the file moved under us and the anchor range no longer
 * exists — the fix renders as a plain fenced block captioned with the line to add it after.
 * That degrades from one-click to copy-paste, which is the correct direction: a suggestion
 * that cannot be built correctly must not be built at all.
 */

/** Read access to the head revision this review is written against. */
export interface ReviewSource {
  read(path: string): string | undefined;
}

export interface BuildReviewOptions {
  /**
   * The scanned workspace. Without it, fixes render as copy-paste blocks rather than
   * click-to-apply suggestions — never as a suggestion built from the insertion alone.
   */
  source?: ReviewSource;
}

export interface ReviewComment {
  path: string;
  /** Last line of the anchor range — GitHub's `line`. */
  line: number;
  /**
   * First line of a multi-line anchor — GitHub's `start_line`. Omitted for a single line.
   * Without it a multi-line suggestion collapses onto one line, and applying it rewrites
   * the wrong region.
   */
  startLine?: number;
  body: string;
}

export interface PullReview {
  event: "COMMENT"; // never REQUEST_CHANGES that auto-merges; humans decide
  summary: string;
  comments: ReviewComment[];
}

function badge(f: Finding): string {
  if (f.tier === "verified") return "🔴 **Verified**";
  return `🟡 **Research** (confidence ${(f.confidence * 100).toFixed(0)}%)`;
}

/** Fence language for a copy-paste block, from the file extension. Cosmetic only. */
const FENCE_LANGUAGE: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  py: "python",
  go: "go",
  sql: "sql",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
};

function fenceLanguage(path: string): string {
  return FENCE_LANGUAGE[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "";
}

/**
 * Render a fix edit into comment body lines.
 *
 * A ```suggestion``` fence is only ever produced with the original anchor text in front of
 * the insertion. `test/gate-review.test.ts` asserts that directly, because the tempting
 * simplification — fencing the insertion on its own — is silently destructive.
 */
function renderEdit(edit: FixEdit, source: ReviewSource | undefined): { body: string[]; applied: boolean } {
  const content = source?.read(edit.path);
  const anchor = content === undefined ? undefined : anchorLines(content, edit);

  if (anchor) {
    return {
      body: ["```suggestion", ...anchor, ...edit.insertedLines.split("\n"), "```"],
      applied: true,
    };
  }

  // No trustworthy anchor text. Say what to add and where, and let a human place it.
  return {
    body: [
      `_Add after line ${edit.endLine} of \`${edit.path}\`:_`,
      "",
      "```" + fenceLanguage(edit.path),
      ...edit.insertedLines.replace(/^\n+/, "").split("\n"),
      "```",
    ],
    applied: false,
  };
}

interface BuiltComment {
  body: string;
  /** Set only when the body contains a suggestion that must anchor to this edit's range. */
  anchor?: FixEdit;
}

function commentBody(f: Finding, source: ReviewSource | undefined): BuiltComment {
  const lines: string[] = [];
  lines.push(
    `${badge(f)} · \`${f.classId}\` · ${f.severity.toUpperCase()}${isCrossSurface(f) ? " · cross-surface" : ""}`,
  );
  lines.push("");
  lines.push(f.explanation);
  if (f.tier === "verified") {
    lines.push("");
    lines.push("<details><summary>Reproduction</summary>");
    lines.push("");
    for (const step of f.reproduction.steps) lines.push(`- ${step}`);
    lines.push(`- _Expected:_ ${f.reproduction.expected}`);
    lines.push("</details>");
  }

  const fix = f.suggestedFix;
  if (!fix) return { body: lines.join("\n") };

  lines.push("");
  lines.push(fix.content);

  // Guidance carries no edit by construction (the schema enforces the pairing), so there is
  // nothing to anchor and nothing to apply.
  if (fix.kind !== "diff" || !fix.edit) return { body: lines.join("\n") };

  const rendered = renderEdit(fix.edit, source);
  lines.push("");
  lines.push(...rendered.body);
  // Only a real suggestion needs the comment re-anchored onto the edit's range; a
  // copy-paste block reads fine wherever the finding already points.
  return { body: lines.join("\n"), anchor: rendered.applied ? fix.edit : undefined };
}

export function buildReview(findings: Finding[], options: BuildReviewOptions = {}): PullReview {
  const verified = findings.filter((f) => f.tier === "verified").length;
  const research = findings.length - verified;

  const comments = findings.map((f): ReviewComment => {
    const { body, anchor } = commentBody(f, options.source);

    // A comment carrying a suggestion MUST anchor to the range the suggestion replaces —
    // usually the finding's own line, but for a multi-line statement it is not, and GitHub
    // applies the suggestion to whatever the comment says.
    if (anchor) {
      return anchor.endLine > anchor.startLine
        ? { path: anchor.path, startLine: anchor.startLine, line: anchor.endLine, body }
        : { path: anchor.path, line: anchor.endLine, body };
    }

    const primary = f.locations[0]!;
    return { path: primary.path, line: primary.startLine, body };
  });

  return {
    event: "COMMENT",
    summary:
      findings.length === 0
        ? "Gatepass: no findings on this change."
        : `Gatepass found ${verified} verified and ${research} research-tier finding(s). ` +
          `Suggestions are advisory — approve any change yourself.`,
    comments,
  };
}
