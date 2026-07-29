import { describe, it, expect, beforeEach } from "vitest";
import { AuditedWriter, InMemoryAuditSink } from "@gatepass/shared";
import type { Finding } from "@gatepass/findings";
import {
  FixPullRequestOpener,
  FixPullRequestError,
  ProtectedPathError,
  isProtectedPath,
  fixBranchName,
  assertWritablePath,
  type FixPullRequestClient,
} from "../src/index.js";

/**
 * Every guarantee in the amended Principle III carve-out gets a test here, because the
 * whole justification for letting Gatepass write to a repository at all is that these
 * conditions hold by construction rather than by care.
 */

const SCHEMA = ["create table invoices (", "  id uuid primary key,", "  tenant_id uuid not null", ");", ""].join("\n");

function rlsFinding(overrides: { path?: string; fingerprint?: string; endLine?: number } = {}): Finding {
  const path = overrides.path ?? "db/schema.sql";
  return {
    fingerprint: overrides.fingerprint ?? "sha256:rls",
    tier: "verified",
    classId: "rls-gap",
    severity: "high",
    surfaces: ["app_code"],
    locations: [{ path, startLine: 1, endLine: 1, surface: "app_code" }],
    explanation: "Table invoices has no RLS",
    reproduction: { kind: "inspection", steps: ["look"], expected: "cross-tenant read" },
    suggestedFix: {
      kind: "diff",
      content: "Enable row-level security.",
      edit: {
        path,
        startLine: 1,
        endLine: overrides.endLine ?? 4,
        operation: "insert_after",
        insertedLines: "\nalter table invoices enable row level security;",
      },
    },
  };
}

const guidanceOnly: Finding = {
  fingerprint: "sha256:cors",
  tier: "verified",
  classId: "cors-misconfig",
  severity: "high",
  surfaces: ["app_code"],
  locations: [{ path: "src/api.ts", startLine: 3, endLine: 3, surface: "app_code" }],
  explanation: "wildcard origin",
  reproduction: { kind: "inspection", steps: ["look"], expected: "any origin reads" },
  suggestedFix: { kind: "agent_guidance", content: "Use an explicit allow-list." },
};

interface Call {
  method: string;
  args: unknown;
}

/**
 * A fake that models refs rather than ignoring them.
 *
 * `getFile` used to return the same content whatever ref it was asked for, which cannot express
 * the situation the resume path exists to handle: a branch whose contents have moved away from
 * base because an earlier, interrupted attempt already wrote some of the files. Per-branch
 * storage — and a real blob sha that changes on write — is what lets a test say "this file was
 * already committed" and have the code under test agree.
 */
class FakeClient implements FixPullRequestClient {
  readonly calls: Call[] = [];
  readonly written = new Map<string, string>();
  files = new Map<string, string>([["db/schema.sql", SCHEMA]]);
  /** Per-branch overlay on top of `files`; empty means the branch matches base. */
  readonly branchFiles = new Map<string, Map<string, { content: string; sha: string }>>();
  readonly openPrs = new Map<string, { number: number; url: string }>();
  existingBranches = new Set<string>(["main"]);
  defaultBranch = "main";
  /** Set to make the next putFile throw, standing in for a dropped connection mid-write. */
  failNextPutFile = false;
  private prCounter = 41;

  private record(method: string, args: unknown) {
    this.calls.push({ method, args });
  }

  /** Put `path` on `branch` as if a previous attempt had committed it there. */
  seedOnBranch(branch: string, path: string, content: string) {
    this.existingBranches.add(branch);
    const overlay = this.branchFiles.get(branch) ?? new Map();
    overlay.set(path, { content, sha: `blob-${path}-seeded` });
    this.branchFiles.set(branch, overlay);
  }

  async getDefaultBranch(): Promise<string> {
    this.record("getDefaultBranch", {});
    return this.defaultBranch;
  }
  async getBranchSha(_repo: string, branch: string): Promise<string> {
    this.record("getBranchSha", { branch });
    return `sha-${branch}`;
  }
  async branchExists(_repo: string, branch: string): Promise<boolean> {
    this.record("branchExists", { branch });
    return this.existingBranches.has(branch);
  }
  async findOpenPullRequest(_repo: string, branch: string) {
    this.record("findOpenPullRequest", { branch });
    return this.openPrs.get(branch);
  }
  async createBranch(_repo: string, branch: string, fromSha: string): Promise<void> {
    this.record("createBranch", { branch, fromSha });
    this.existingBranches.add(branch);
  }
  async getFile(_repo: string, ref: string, path: string) {
    this.record("getFile", { ref, path });
    const onBranch = this.branchFiles.get(ref)?.get(path);
    if (onBranch) return { ...onBranch };
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`no such file ${path}`);
    return { content, sha: `blob-${path}` };
  }
  async putFile(args: { repo: string; branch: string; path: string; content: string; sha: string; message: string }) {
    this.record("putFile", args);
    if (this.failNextPutFile) {
      this.failNextPutFile = false;
      throw new Error("connection reset by peer");
    }
    this.written.set(args.path, args.content);
    const overlay = this.branchFiles.get(args.branch) ?? new Map();
    overlay.set(args.path, { content: args.content, sha: `blob-${args.path}-${overlay.size + 1}` });
    this.branchFiles.set(args.branch, overlay);
  }
  async createPullRequest(args: { repo: string; head: string; base: string; title: string; body: string }) {
    this.record("createPullRequest", args);
    const pr = { number: ++this.prCounter, url: `https://github.com/acme/app/pull/${this.prCounter}` };
    this.openPrs.set(args.head, pr);
    return pr;
  }
}

describe("protected paths — CI configuration is never written", () => {
  it("refuses every CI configuration location", () => {
    for (const path of [
      ".github/workflows/ci.yml",
      ".github/dependabot.yml",
      ".gitlab-ci.yml",
      ".circleci/config.yml",
      ".travis.yml",
      "azure-pipelines.yml",
      "Jenkinsfile",
      "ci/Jenkinsfile",
      ".buildkite/pipeline.yml",
      "bitbucket-pipelines.yml",
    ]) {
      expect(isProtectedPath(path), path).toBe(true);
    }
  });

  it("refuses a path that escapes the repository", () => {
    expect(isProtectedPath("../../etc/passwd")).toBe(true);
    expect(isProtectedPath("src/../../secrets")).toBe(true);
  });

  it("allows ordinary source paths", () => {
    for (const path of ["db/schema.sql", "src/api.ts", "package.json", "github/notes.md"]) {
      expect(isProtectedPath(path), path).toBe(false);
    }
  });

  it("assertWritablePath throws a ProtectedPathError, which is never recoverable", () => {
    expect(() => assertWritablePath(".github/workflows/ci.yml")).toThrow(ProtectedPathError);
    expect(() => assertWritablePath("db/schema.sql")).not.toThrow();
  });
});

describe("fixBranchName", () => {
  it("always namespaces under gatepass/ and is stable for a scan", () => {
    const name = fixBranchName("3f9a1c22-dead-beef-0000-111122223333");
    expect(name).toBe("gatepass/fix-3f9a1c22");
    expect(fixBranchName("3f9a1c22-dead-beef-0000-111122223333")).toBe(name);
  });

  it("survives a scan id with no alphanumerics", () => {
    expect(fixBranchName("----")).toBe("gatepass/fix-scan");
  });
});

describe("FixPullRequestOpener", () => {
  let client: FakeClient;
  let sink: InMemoryAuditSink;
  let opener: FixPullRequestOpener;

  beforeEach(() => {
    client = new FakeClient();
    sink = new InMemoryAuditSink();
    opener = new FixPullRequestOpener(client, new AuditedWriter(sink, "tester"));
  });

  it("opens a PR from a new branch off the default branch", async () => {
    const result = await opener.open("acme", "acme/app", "scan1234-abcd", [rlsFinding()]);
    expect(result.number).toBe(42);
    expect(result.branch).toBe("gatepass/fix-scan1234");
    expect(result.base).toBe("main");
    expect(result.files).toEqual(["db/schema.sql"]);
    expect(client.calls.find((c) => c.method === "createBranch")).toBeDefined();
  });

  it("applies the edit as an insertion — the original lines survive", async () => {
    await opener.open("acme", "acme/app", "scan1", [rlsFinding()]);
    const written = client.written.get("db/schema.sql")!;
    expect(written).toContain("create table invoices (");
    expect(written).toContain("  tenant_id uuid not null");
    expect(written).toContain("alter table invoices enable row level security;");
    // The insertion lands after the statement, not inside it.
    expect(written.indexOf(");")).toBeLessThan(written.indexOf("alter table"));
  });

  it("never pushes to the default branch", async () => {
    await opener.open("acme", "acme/app", "scan1", [rlsFinding()]);
    for (const call of client.calls) {
      if (call.method === "putFile") expect((call.args as { branch: string }).branch).toBe("gatepass/fix-scan1");
    }
  });

  it("refuses when the computed branch IS the base", async () => {
    client.defaultBranch = "gatepass/fix-scan1";
    await expect(opener.open("acme", "acme/app", "scan1", [rlsFinding()])).rejects.toThrow(
      /only ever delivered on a new branch/,
    );
  });

  it("refuses a second PR when one is already open for this scan", async () => {
    client.existingBranches.add("gatepass/fix-scan1");
    client.openPrs.set("gatepass/fix-scan1", { number: 7, url: "https://github.com/acme/app/pull/7" });
    await expect(opener.open("acme", "acme/app", "scan1", [rlsFinding()])).rejects.toThrow(/already open/);
    expect(client.written.size).toBe(0);
  });

  /*
   * The lockout this whole path exists to prevent.
   *
   * GitHub's contents API writes one file per call, so a dropped connection partway through
   * leaves the branch created and the PR unopened. Because the branch name is derived from the
   * scan id, the retry used to hit "branch already exists" and tell the user to delete it by
   * hand — one network blip permanently disabled fix PRs for that scan.
   */
  it("recovers from a write interrupted partway through, rather than dead-ending", async () => {
    client.failNextPutFile = true;
    await expect(opener.open("acme", "acme/app", "scan1", [rlsFinding()])).rejects.toThrow(/connection reset/);
    // The branch is there, nothing was committed to it, and no PR exists.
    expect(client.existingBranches.has("gatepass/fix-scan1")).toBe(true);
    expect(client.openPrs.size).toBe(0);

    // The retry succeeds instead of refusing.
    const result = await opener.open("acme", "acme/app", "scan1", [rlsFinding()]);
    expect(result.number).toBeGreaterThan(0);
    expect(result.files).toEqual(["db/schema.sql"]);
    // It reused the branch rather than trying to create it a second time.
    expect(client.calls.filter((c) => c.method === "createBranch")).toHaveLength(1);
  });

  it("does not apply a fix twice when resuming over a file the earlier attempt did write", async () => {
    const first = await opener.open("acme", "acme/app", "scan1", [rlsFinding()]);
    const committed = client.written.get("db/schema.sql")!;
    // Drop the PR so the branch looks like an interrupted attempt, then run it again.
    client.openPrs.delete(first.branch);
    client.written.clear();

    const again = await opener.open("acme", "acme/app", "scan1", [rlsFinding()]);
    expect(again.files).toEqual(["db/schema.sql"]);
    // Nothing was rewritten, and the branch still holds exactly one copy of the fix.
    expect(client.written.size).toBe(0);
    const onBranch = client.branchFiles.get(first.branch)!.get("db/schema.sql")!.content;
    expect(onBranch).toBe(committed);
    expect(onBranch.match(/enable row level security/g)).toHaveLength(1);
  });

  it("refuses to write over a branch a human has edited", async () => {
    client.seedOnBranch("gatepass/fix-scan1", "db/schema.sql", "-- someone else's work\n");
    await expect(opener.open("acme", "acme/app", "scan1", [rlsFinding()])).rejects.toThrow(/has been edited/);
    expect(client.written.size).toBe(0);
  });

  it("writes nothing at all when an edit no longer matches the file", async () => {
    client.files.set("db/schema.sql", "create table invoices (id int);\n"); // 1 line, edit anchors at 4
    await expect(opener.open("acme", "acme/app", "scan1", [rlsFinding()])).rejects.toThrow(/anchors at line 4/);
    expect(client.written.size).toBe(0);
    expect(client.calls.some((c) => c.method === "createBranch")).toBe(false);
  });

  it("skips a fix that targets CI configuration and says why", async () => {
    const ciFix = rlsFinding({ path: ".github/workflows/ci.yml", fingerprint: "sha256:ci" });
    await expect(opener.open("acme", "acme/app", "scan1", [ciFix])).rejects.toThrow(
      /every applicable edit targets CI configuration/,
    );
    expect(client.written.size).toBe(0);
  });

  it("excludes a CI-config fix but still delivers the others", async () => {
    const result = await opener.open("acme", "acme/app", "scan1", [
      rlsFinding(),
      rlsFinding({ path: ".github/workflows/ci.yml", fingerprint: "sha256:ci" }),
    ]);
    expect(result.files).toEqual(["db/schema.sql"]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/CI configuration/);
    expect([...client.written.keys()]).not.toContain(".github/workflows/ci.yml");
  });

  it("refuses when every finding is guidance-only", async () => {
    await expect(opener.open("acme", "acme/app", "scan1", [guidanceOnly])).rejects.toThrow(FixPullRequestError);
    await expect(opener.open("acme", "acme/app", "scan1", [guidanceOnly])).rejects.toThrow(
      /a value a human has to choose/,
    );
  });

  it("honours a fingerprint filter", async () => {
    const a = rlsFinding({ fingerprint: "sha256:a" });
    const b = rlsFinding({ path: "db/other.sql", fingerprint: "sha256:b" });
    client.files.set("db/other.sql", SCHEMA);
    const result = await opener.open("acme", "acme/app", "scan1", [a, b], { fingerprints: ["sha256:b"] });
    expect(result.files).toEqual(["db/other.sql"]);
    expect(result.applied).toEqual(["sha256:b"]);
  });

  it("records one audit event naming the repo, branch, base and files", async () => {
    await opener.open("acme", "acme/app", "scan1", [rlsFinding()], { requestedBy: "dana" });
    expect(sink.events).toHaveLength(1);
    const event = sink.events[0]!;
    expect(event.action).toBe("fix_pr");
    expect(event.orgId).toBe("acme");
    expect(event.subject).toMatchObject({
      repo: "acme/app",
      branch: "gatepass/fix-scan1",
      base: "main",
      files: ["db/schema.sql"],
      requestedBy: "dana",
    });
  });

  it("records no audit event when the operation is refused", async () => {
    // A branch with an open PR — a genuine refusal. A branch *without* one is an interrupted
    // attempt that now resumes, so it is no longer a refusal and would not test this.
    client.existingBranches.add("gatepass/fix-scan1");
    client.openPrs.set("gatepass/fix-scan1", { number: 7, url: "https://github.com/acme/app/pull/7" });
    await expect(opener.open("acme", "acme/app", "scan1", [rlsFinding()])).rejects.toThrow();
    expect(sink.events).toHaveLength(0);
  });

  it("never merges or approves anything", async () => {
    await opener.open("acme", "acme/app", "scan1", [rlsFinding()]);
    expect(client.calls.map((c) => c.method)).not.toContain("merge");
    const pr = client.calls.find((c) => c.method === "createPullRequest")!.args as { body: string };
    expect(pr.body).toMatch(/advisory and unverified/i);
    expect(pr.body).toMatch(/does not modify CI configuration/i);
    expect(pr.body).toMatch(/Read every hunk before/i);
  });

  it("states in the PR body that it was opened on explicit request", async () => {
    await opener.open("acme", "acme/app", "scan1", [rlsFinding()], { requestedBy: "dana" });
    const pr = client.calls.find((c) => c.method === "createPullRequest")!.args as { body: string };
    expect(pr.body).toContain("Opened on explicit request by `dana`");
    expect(pr.body).toMatch(/does not open pull requests on its own/i);
  });

  it("combines several fixes in one file bottom-up so anchors do not shift", async () => {
    // Two tables in one migration: lines 1-4 and 6-9.
    client.files.set(
      "db/schema.sql",
      ["create table a (", "  id uuid,", "  tenant_id uuid", ");", "", "create table b (", "  id uuid", ");", ""].join(
        "\n",
      ),
    );
    const first = { ...rlsFinding({ fingerprint: "sha256:1" }) };
    first.suggestedFix!.edit!.insertedLines = "\nalter table a enable row level security;";
    const second = rlsFinding({ fingerprint: "sha256:2" });
    second.suggestedFix!.edit!.startLine = 6;
    second.suggestedFix!.edit!.endLine = 8;
    second.suggestedFix!.edit!.insertedLines = "\nalter table b enable row level security;";

    await opener.open("acme", "acme/app", "scan1", [first, second]);
    const written = client.written.get("db/schema.sql")!.split("\n");

    // Both landed, and the earlier insertion did not push the later anchor out from under it:
    // `alter table b` still follows `create table b`, not the middle of it.
    expect(written.filter((l) => l.startsWith("alter table"))).toHaveLength(2);
    expect(written.indexOf("alter table a enable row level security;")).toBeLessThan(
      written.indexOf("create table b ("),
    );
    expect(written.indexOf("create table b (")).toBeLessThan(
      written.indexOf("alter table b enable row level security;"),
    );
  });
});
