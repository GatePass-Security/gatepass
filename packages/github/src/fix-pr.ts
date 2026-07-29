import { applyFixEdits, type Finding, type FixEdit } from "@gatepass/findings";
import type { AuditedWriter } from "@gatepass/shared";

/**
 * Suggested-fix pull requests (Principle III, as amended).
 *
 * Gatepass suggests; humans approve. A pull request that a human explicitly asked for, on a
 * new branch, that a human must review and merge, IS a suggestion — it is delivered in the
 * developer's workflow rather than behind their back. A silent or automatic one is not, and
 * this module cannot produce one.
 *
 * The guarantees, each enforced here rather than documented and hoped for:
 *
 *  - **Explicit trigger only.** Nothing in this module runs from a webhook. The caller must
 *    come from a human action, and the org must have opted in (checked in the API handler,
 *    which owns the org record).
 *  - **A new branch, always.** `openFixPullRequest` refuses a branch that already exists and
 *    refuses to target the default branch. There is no force-push path — the client
 *    interface has no method that could perform one.
 *  - **Never CI configuration.** `assertWritablePath` rejects `.github/workflows/**` and
 *    every other CI config location before a single write is issued. This is checked again
 *    immediately before each write, so a future refactor that reorders the pipeline cannot
 *    route around it.
 *  - **Always audited.** The whole operation runs inside one `AuditedWriter.write("fix_pr")`,
 *    whose subject names the repo, branch, base, files and findings involved.
 *  - **Never merged.** Nothing here merges, approves, or enables auto-merge, and the PR body
 *    says in plain words that the changes are advisory and unverified.
 *
 * Note the interface split: `GitHubClient` (poster.ts) still has NO code-writing method, and
 * must stay that way. Code writing lives behind this separate, explicitly-named interface
 * that a deployment has to be configured with. A Gatepass install that never wires a
 * `FixPullRequestClient` is structurally incapable of writing to a repository at all.
 */

export class FixPullRequestError extends Error {}

/** A write was aimed at a path Gatepass must never touch. Never recoverable — always a bug. */
export class ProtectedPathError extends FixPullRequestError {}

/** The deployment has no fix-PR client wired. Surfaces to the dashboard as "not set up". */
export const FIX_PR_UNCONFIGURED = "fix pull requests are not configured on this deployment";

/**
 * CI configuration Gatepass must never write, at any time, for any reason (Constitution
 * Principle III: "A CI gate MAY block a merge; it MUST NOT rewrite code", and the standing
 * prohibition on mutating CI config).
 *
 * Matched against POSIX repo-relative paths. Broad on purpose: `.github/` as a whole is
 * excluded rather than just `workflows/`, because Actions also reads composite actions and
 * `dependabot.yml` from there, and the cost of being too broad is one skipped suggestion
 * while the cost of being too narrow is rewriting a customer's pipeline.
 */
const PROTECTED_PATH_PATTERNS: readonly RegExp[] = [
  /^\.github\//i,
  /^\.gitlab-ci\.ya?ml$/i,
  /^\.gitlab\//i,
  /^\.circleci\//i,
  /^\.buildkite\//i,
  /^\.travis\.ya?ml$/i,
  /^\.drone\.ya?ml$/i,
  /^\.woodpecker/i,
  /^appveyor\.ya?ml$/i,
  /^azure-pipelines[^/]*\.ya?ml$/i,
  /^jenkinsfile$/i,
  /(^|\/)jenkinsfile$/i,
  /^bitbucket-pipelines\.ya?ml$/i,
  /^\.teamcity\//i,
];

/** True when Gatepass is forbidden from writing this path. */
export function isProtectedPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.startsWith("../") || normalized.includes("/../")) return true; // escapes the repo
  return PROTECTED_PATH_PATTERNS.some((re) => re.test(normalized));
}

export function assertWritablePath(path: string): void {
  if (isProtectedPath(path)) {
    throw new ProtectedPathError(
      `Gatepass will not write ${path}: CI configuration and repository metadata are never modified.`,
    );
  }
}

/**
 * Branch name for a scan's fixes. Derived from the scan id so re-running the action for the
 * same scan collides with its own earlier branch rather than silently opening a second PR —
 * "no unsolicited PR floods" is easier to keep when repeats are refused by construction.
 */
export function fixBranchName(scanId: string): string {
  const slug = scanId
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toLowerCase();
  return `gatepass/fix-${slug || "scan"}`;
}

export interface RepoFileContents {
  content: string;
  /** Blob sha — GitHub requires it on update, and it is what makes the write a no-clobber. */
  sha: string;
}

/**
 * The opt-in code-writing capability. Kept separate from `GitHubClient` on purpose: that
 * interface's inability to write code is a structural guarantee, and widening it would
 * delete the guarantee for every deployment at once.
 *
 * Note what is absent and must stay absent: no force-push, no branch delete, no merge, no
 * default-branch write, no workflow endpoint.
 */
export interface FixPullRequestClient {
  getDefaultBranch(repo: string): Promise<string>;
  getBranchSha(repo: string, branch: string): Promise<string>;
  /** Must resolve false when the branch does not exist, rather than throwing. */
  branchExists(repo: string, branch: string): Promise<boolean>;
  /**
   * The open PR whose head is `branch`, if there is one. A READ — it is what lets an
   * interrupted attempt be told apart from a finished one. Must resolve undefined rather
   * than throwing when there is no such PR.
   */
  findOpenPullRequest(repo: string, branch: string): Promise<{ number: number; url: string } | undefined>;
  createBranch(repo: string, branch: string, fromSha: string): Promise<void>;
  getFile(repo: string, ref: string, path: string): Promise<RepoFileContents>;
  putFile(args: {
    repo: string;
    branch: string;
    path: string;
    content: string;
    sha: string;
    message: string;
  }): Promise<void>;
  createPullRequest(args: {
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<{ number: number; url: string }>;
}

export interface SkippedFix {
  fingerprint: string;
  classId: string;
  path: string;
  reason: string;
}

export interface FixPullRequestResult {
  number: number;
  url: string;
  branch: string;
  base: string;
  /** Paths actually written, in the order committed. */
  files: string[];
  /** Fingerprints whose fix landed in the branch. */
  applied: string[];
  skipped: SkippedFix[];
}

export interface OpenFixPullRequestOptions {
  /** Restrict to these fingerprints. Absent ⇒ every finding with an applicable edit. */
  fingerprints?: readonly string[];
  /** Base branch. Defaults to the repository's default branch. */
  base?: string;
  /** Who asked. Recorded in the PR body so the trigger is visible from the PR itself. */
  requestedBy?: string;
}

interface PlannedFile {
  path: string;
  edits: FixEdit[];
  findings: Finding[];
}

/**
 * Group the applicable fixes by file. Findings without a `diff` fix are not skips — they
 * never had an edit to apply — so only genuinely blocked ones are reported.
 */
function planFiles(
  findings: readonly Finding[],
  fingerprints: readonly string[] | undefined,
): { files: PlannedFile[]; skipped: SkippedFix[] } {
  const wanted = fingerprints ? new Set(fingerprints) : undefined;
  const byPath = new Map<string, PlannedFile>();
  const skipped: SkippedFix[] = [];

  for (const finding of findings) {
    if (wanted && !wanted.has(finding.fingerprint)) continue;
    const edit = finding.suggestedFix?.kind === "diff" ? finding.suggestedFix.edit : undefined;
    if (!edit) continue;

    if (isProtectedPath(edit.path)) {
      skipped.push({
        fingerprint: finding.fingerprint,
        classId: finding.classId,
        path: edit.path,
        reason: "CI configuration is never modified by Gatepass",
      });
      continue;
    }

    let entry = byPath.get(edit.path);
    if (!entry) {
      entry = { path: edit.path, edits: [], findings: [] };
      byPath.set(edit.path, entry);
    }
    entry.edits.push(edit);
    entry.findings.push(finding);
  }

  // Deterministic commit order so the same scan produces the same branch twice.
  return { files: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)), skipped };
}

function commitMessage(file: PlannedFile): string {
  const classes = [...new Set(file.findings.map((f) => f.classId))].sort().join(", ");
  return `fix(security): ${classes} in ${file.path}\n\nSuggested by Gatepass. Advisory — review before merging.`;
}

function pullRequestBody(
  scanId: string,
  applied: PlannedFile[],
  skipped: readonly SkippedFix[],
  requestedBy: string | undefined,
): string {
  const lines: string[] = [];
  lines.push("## Gatepass suggested fixes");
  lines.push("");
  lines.push(
    "**These changes are advisory and unverified.** Gatepass generated them from a static scan; " +
      "nothing here has been built, run, or tested against this repository. Read every hunk before " +
      "you merge, and do not merge on the strength of the tool's confidence.",
  );
  lines.push("");
  lines.push(
    `Opened on explicit request${requestedBy ? ` by \`${requestedBy}\`` : ""} from scan \`${scanId}\`. ` +
      "Gatepass does not open pull requests on its own, does not push to your default branch, and does " +
      "not modify CI configuration.",
  );
  lines.push("");
  lines.push("### What changed");
  lines.push("");
  for (const file of applied) {
    lines.push(`- \`${file.path}\``);
    for (const finding of file.findings) {
      const tier = finding.tier === "verified" ? "verified" : `research, ${(finding.confidence * 100).toFixed(0)}%`;
      lines.push(`  - \`${finding.classId}\` (${tier}) — ${finding.explanation}`);
    }
  }

  if (skipped.length > 0) {
    lines.push("");
    lines.push("### Not included");
    lines.push("");
    for (const s of skipped) lines.push(`- \`${s.classId}\` in \`${s.path}\` — ${s.reason}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "Fixes that need a value only you can choose — an allow-listed origin, a version to pin, an RLS " +
      "policy predicate — are deliberately **not** in this branch. They are reported as guidance on the " +
      "finding instead, because a placeholder committed here would look like a decision someone made.",
  );
  return lines.join("\n");
}

/**
 * Open a pull request containing the suggested fixes for a scan.
 *
 * Every check that can be made before writing is made before writing: the base is resolved, the
 * paths are guarded, and every edit is applied to the file it anchors to in memory. If any of
 * that fails, nothing has been written.
 *
 * What it cannot promise is atomicity across the writes themselves. GitHub's contents API takes
 * one file per call, so a network failure partway through leaves a branch holding some of the
 * fixes and no pull request. That used to be unrecoverable: the branch name is derived from the
 * scan id, so the next attempt hit "branch already exists" and told the user to delete it by
 * hand — one dropped connection permanently disabled the feature for that scan.
 *
 * So an existing branch is no longer assumed to mean "already done". It means one of two things,
 * and they are distinguished by asking whether a PR was ever opened from it:
 *
 *   - a PR exists  ⇒ the earlier attempt finished. Refuse, and point at it. (This is the
 *     "no unsolicited PR floods" guarantee: one PR per scan, never a second.)
 *   - no PR exists ⇒ the earlier attempt was interrupted. Resume onto the same branch.
 *
 * Resuming re-derives each file from `base` and compares against what is on the branch, so it is
 * idempotent: a file already written is left alone rather than having the fix inserted into it
 * twice. A file on the branch that matches neither the original nor the intended result means a
 * human has edited this branch, and that aborts before anything is written.
 */
export class FixPullRequestOpener {
  constructor(
    private readonly client: FixPullRequestClient,
    private readonly writer: AuditedWriter,
  ) {}

  async open(
    orgId: string,
    repo: string,
    scanId: string,
    findings: readonly Finding[],
    options: OpenFixPullRequestOptions = {},
  ): Promise<FixPullRequestResult> {
    const { files, skipped } = planFiles(findings, options.fingerprints);
    if (files.length === 0) {
      throw new FixPullRequestError(
        skipped.length > 0
          ? "No fixes can be delivered as a pull request: every applicable edit targets CI configuration, which Gatepass never modifies."
          : "No findings in this scan carry an applicable fix. Guidance-only findings need a value a human has to choose, so there is nothing to commit.",
      );
    }

    const branch = fixBranchName(scanId);
    const base = options.base ?? (await this.client.getDefaultBranch(repo));

    // Refusing to write the base branch is the single most important check here. It is done
    // before anything else so no partial state can exist when it fails.
    if (branch === base) {
      throw new FixPullRequestError(`refusing to write to "${base}": fixes are only ever delivered on a new branch`);
    }
    /*
     * An existing branch is ambiguous, and the two cases need opposite handling. An open PR
     * from it means the work is done; anything else means a previous attempt died partway and
     * left the branch behind. Only the first is a reason to refuse.
     */
    const resuming = await this.client.branchExists(repo, branch);
    if (resuming) {
      const existing = await this.client.findOpenPullRequest(repo, branch);
      if (existing) {
        throw new FixPullRequestError(
          `a fix pull request for this scan is already open: ${existing.url} (#${existing.number}). ` +
            `Gatepass opens one per scan — review or close that one rather than opening a second.`,
        );
      }
    }

    return this.writer.write(
      "fix_pr",
      orgId,
      {
        repo,
        scanId,
        branch,
        base,
        files: files.map((f) => f.path),
        findings: files.flatMap((f) => f.findings.map((x) => x.fingerprint)),
        skipped: skipped.length,
        requestedBy: options.requestedBy ?? null,
        // Whether this wrote onto a branch a previous attempt left behind. An audit reader
        // asking "why does this branch predate its PR" should not have to guess.
        resumed: resuming,
      },
      async () => {
        const baseSha = await this.client.getBranchSha(repo, base);

        // Read and rewrite every file BEFORE creating the branch, so a bad anchor fails with
        // nothing written at all rather than leaving an empty branch behind.
        const planned: { path: string; original: string; content: string; sha: string; message: string }[] = [];
        for (const file of files) {
          assertWritablePath(file.path);
          const current = await this.client.getFile(repo, base, file.path);
          planned.push({
            path: file.path,
            original: current.content,
            content: applyFixEdits(current.content, file.edits),
            sha: current.sha,
            message: commitMessage(file),
          });
        }

        /*
         * Which files still need writing.
         *
         * On a fresh branch that is all of them. On a resumed one it is only those the
         * interrupted attempt did not reach — established by comparing the branch's copy against
         * both the original and the intended result, which is what makes a retry idempotent
         * rather than inserting the same fix a second time. Every file is classified before any
         * write, so a branch a human has edited aborts having added nothing.
         */
        const pending: typeof planned = [];
        if (resuming) {
          for (const file of planned) {
            const onBranch = await this.client.getFile(repo, branch, file.path);
            if (onBranch.content === file.content) continue; // the earlier attempt got this far
            if (onBranch.content !== file.original) {
              throw new FixPullRequestError(
                `branch "${branch}" has been edited since Gatepass created it — ${file.path} matches neither ` +
                  `the original file nor the suggested fix. Gatepass will not write over someone else's work: ` +
                  `close or delete that branch and run this again.`,
              );
            }
            // Untouched by the earlier attempt. The no-clobber sha has to be the branch's copy.
            pending.push({ ...file, sha: onBranch.sha });
          }
        } else {
          await this.client.createBranch(repo, branch, baseSha);
          pending.push(...planned);
        }

        for (const file of pending) {
          // Re-checked at the point of the write itself: the guard must hold even if the
          // planning above is ever refactored or bypassed.
          assertWritablePath(file.path);
          await this.client.putFile({
            repo,
            branch,
            path: file.path,
            content: file.content,
            sha: file.sha,
            message: file.message,
          });
        }

        const pr = await this.client.createPullRequest({
          repo,
          head: branch,
          base,
          title: `Gatepass: suggested security fixes (${files.length} file${files.length === 1 ? "" : "s"})`,
          body: pullRequestBody(scanId, files, skipped, options.requestedBy),
        });

        return {
          number: pr.number,
          url: pr.url,
          branch,
          base,
          // Every file the branch carries, not only those this attempt wrote — on a resume the
          // rest were already committed, and the PR contains them all either way.
          files: planned.map((f) => f.path),
          applied: files.flatMap((f) => f.findings.map((x) => x.fingerprint)),
          skipped,
        };
      },
    );
  }
}
