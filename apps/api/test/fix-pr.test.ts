import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
import type { FixPullRequestClient } from "@gatepass/github";
import type { Store } from "../src/store.js";

/**
 * End-to-end cover for the suggested-fix pull request route (Principle III, as amended).
 *
 * The route is the explicit human trigger, so what matters here is that it refuses cleanly
 * in every case where consent, configuration, or a target is missing — and that a
 * deployment with no GitHub App produces a message the dashboard can turn into an
 * explanation rather than a stack trace.
 */

let base: string;
let close: () => void;
let store: Store;
let workspace: string;

/** A fixture with one rls-gap finding, which is the class that yields an applicable edit. */
const SCHEMA = ["create table invoices (", "  id uuid primary key,", "  tenant_id uuid not null", ");", ""].join("\n");

class FakeFixClient implements FixPullRequestClient {
  files = new Map<string, string>();
  written: string[] = [];
  branches = new Set(["main"]);
  openPrs = new Map<string, { number: number; url: string }>();

  async getDefaultBranch() {
    return "main";
  }
  async getBranchSha(_r: string, b: string) {
    return `sha-${b}`;
  }
  async branchExists(_r: string, b: string) {
    return this.branches.has(b);
  }
  /** No PR is ever open here, so an existing branch reads as an interrupted attempt. */
  async findOpenPullRequest(_r: string, b: string) {
    return this.openPrs.get(b);
  }
  async createBranch(_r: string, b: string) {
    this.branches.add(b);
  }
  async getFile(_r: string, _ref: string, p: string) {
    const content = this.files.get(p);
    if (content === undefined) throw new Error(`no such file ${p}`);
    return { content, sha: `blob-${p}` };
  }
  async putFile(args: { path: string; content: string }) {
    this.written.push(args.path);
    this.files.set(args.path, args.content);
  }
  async createPullRequest() {
    return { number: 7, url: "https://github.com/acme/app/pull/7" };
  }
}

async function boot(fixPrClient?: FixPullRequestClient) {
  const created = await createServer({ fixPrClient });
  store = created.store;
  await new Promise<void>((r) => created.server.listen(0, r));
  const { port } = created.server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  close = () => created.server.close();
}

/** Scan a real directory so the store holds a genuine scan with a real fix on it. */
async function scanFixture(): Promise<string> {
  const res = await fetch(`${base}/v1/orgs/demo/scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: workspace }),
  });
  const json = (await res.json()) as { scanId: string };
  return json.scanId;
}

async function openFixPr(orgId: string, scanId: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/v1/orgs/${orgId}/scans/${scanId}/fix-pr`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "gatepass-fixpr-"));
  await fs.mkdir(path.join(workspace, "db"), { recursive: true });
  await fs.writeFile(path.join(workspace, "db", "schema.sql"), SCHEMA, "utf8");
});

afterEach(async () => {
  close?.();
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("POST /v1/orgs/:org/scans/:id/fix-pr — refusals", () => {
  it("says the deployment is not configured when no fix-PR client is wired", async () => {
    await boot(); // no client — the normal state of a fresh deployment
    const scanId = await scanFixture();
    const { status, json } = await openFixPr("demo", scanId);
    // 501, not 500: nothing is broken, an operator just has not wired credentials. A 500 tells
    // clients to retry and puts a configuration gap in the bucket that pages an on-call engineer.
    expect(status).toBe(501);
    // The dashboard's errors.ts keys off this exact phrase to explain the gap.
    expect(String(json.error)).toContain("fix pull requests are not configured");
  });

  it("403s for an org that has not opted in", async () => {
    await boot(new FakeFixClient());
    const scanId = await scanFixture();
    // `no-agent` is seeded without fixPrEnabled.
    await store.putScan({
      ...(await store.getScan(scanId))!,
      id: "borrowed",
      orgId: "no-agent",
      disputes: new Map(),
    });
    const { status, json } = await openFixPr("no-agent", "borrowed");
    expect(status).toBe(403);
    expect(String(json.error)).toContain("not enabled for this org");
  });

  it("422s when the scan has no GitHub repository behind it", async () => {
    await boot(new FakeFixClient());
    // A local-path scan connects the repo as `local_path`, so there is no remote.
    const scanId = await scanFixture();
    const { status, json } = await openFixPr("demo", scanId);
    expect(status).toBe(422);
    expect(String(json.error)).toContain("not associated with a GitHub repository");
  });

  it("404s for a scan that does not exist", async () => {
    await boot(new FakeFixClient());
    const { status } = await openFixPr("demo", "00000000-0000-0000-0000-000000000000");
    expect(status).toBe(404);
  });

  it("has no GET form — a repository write is never a safe idempotent read", async () => {
    await boot(new FakeFixClient());
    const scanId = await scanFixture();
    const res = await fetch(`${base}/v1/orgs/demo/scans/${scanId}/fix-pr`);
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/orgs/:org/scans/:id/fix-pr — success", () => {
  it("opens a PR on a new branch for a scan attached to a GitHub repo", async () => {
    const client = new FakeFixClient();
    client.files.set("db/schema.sql", SCHEMA);
    await boot(client);

    const scanId = await scanFixture();
    // Re-point the connected repo at a GitHub slug, as a clone-and-scan would have.
    await store.putRepo!("demo", "acme/app", scanId, { source: "github" });

    const { status, json } = await openFixPr("demo", scanId, { requestedBy: "dana" });
    expect(status).toBe(201);
    expect(json.number).toBe(7);
    expect(json.branch).toBe(
      `gatepass/fix-${scanId
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 8)
        .toLowerCase()}`,
    );
    expect(json.base).toBe("main");
    expect(json.files).toEqual(["db/schema.sql"]);

    // The write was additive: the developer's DDL is still there, with RLS added after it.
    const written = client.files.get("db/schema.sql")!;
    expect(written).toContain("create table invoices (");
    expect(written).toContain("alter table invoices enable row level security;");
  });

  it("excludes a finding that was disputed away", async () => {
    const client = new FakeFixClient();
    client.files.set("db/schema.sql", SCHEMA);
    await boot(client);

    const scanId = await scanFixture();
    await store.putRepo!("demo", "acme/app", scanId, { source: "github" });
    const findings = await store.findingsOf(scanId);
    const rls = findings.find((f) => f.classId === "rls-gap")!;

    await fetch(`${base}/v1/findings/${encodeURIComponent(rls.fingerprint)}/dispute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scanId, reason: "intentional" }),
    });

    const { status, json } = await openFixPr("demo", scanId);
    expect(status).toBe(422);
    expect(String(json.error)).toMatch(/no findings in this scan carry an applicable fix/i);
    expect(client.written).toHaveLength(0);
  });
});

describe("percent-encoded path parameters", () => {
  /*
   * Every fingerprint starts `sha256:`, and the dashboard sends `encodeURIComponent(...)`.
   * Before the router decoded its segments, the handler looked up the literal `sha256%3A…`
   * and Dispute answered 404 for every finding on the page. The API's own tests missed it
   * because they interpolate the raw fingerprint, where `:` needs no escaping.
   */
  it("resolves a finding whose fingerprint was percent-encoded by the client", async () => {
    await boot();
    const scanId = await scanFixture();
    const rls = (await store.findingsOf(scanId)).find((f) => f.classId === "rls-gap")!;
    expect(rls.fingerprint).toContain(":"); // the character that needs escaping

    const res = await fetch(`${base}/v1/findings/${encodeURIComponent(rls.fingerprint)}/dispute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scanId, reason: "intentional" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { suppressed: string }).toMatchObject({ suppressed: rls.fingerprint });
  });

  it("resolves agent guidance for a percent-encoded fingerprint", async () => {
    await boot();
    const scanId = await scanFixture();
    const rls = (await store.findingsOf(scanId)).find((f) => f.classId === "rls-gap")!;
    const res = await fetch(
      `${base}/v1/orgs/demo/scans/${scanId}/agent-guidance?fingerprint=${encodeURIComponent(rls.fingerprint)}`,
    );
    expect(res.status).toBe(200);
  });
});

describe("scan findings now carry their suggested fix", () => {
  it("attaches a fix to every finding the pipeline emits", async () => {
    await boot();
    const scanId = await scanFixture();
    const res = await fetch(`${base}/v1/scans/${scanId}/findings`);
    const findings = (await res.json()) as {
      classId: string;
      suggestedFix?: { kind: string; edit?: { startLine: number; endLine: number } };
    }[];
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.suggestedFix, f.classId).toBeDefined();

    const rls = findings.find((f) => f.classId === "rls-gap")!;
    expect(rls.suggestedFix!.kind).toBe("diff");
    expect(rls.suggestedFix!.edit!.endLine).toBe(4); // the statement's terminator, not line 1
  });

  it("serves the same fix through the agent-guidance endpoint", async () => {
    await boot();
    const scanId = await scanFixture();
    const findings = await store.findingsOf(scanId);
    const rls = findings.find((f) => f.classId === "rls-gap")!;

    const res = await fetch(
      `${base}/v1/orgs/demo/scans/${scanId}/agent-guidance?fingerprint=${encodeURIComponent(rls.fingerprint)}`,
    );
    const json = (await res.json()) as { classId: string; guidance: { kind: string; content: string } };
    expect(json.classId).toBe("rls-gap");
    // Identical to what the findings list and the PR comment show — one source, not three.
    expect(json.guidance).toEqual(rls.suggestedFix);
  });
});
