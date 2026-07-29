import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeHandlers } from "../src/handlers.js";
import { MemoryStore } from "../src/store.js";

let base: string;
let close: () => void;

/*
 * The runner-upload and benchmark-publish routes require a bearer token (see
 * write-auth.test.ts for the auth behaviour itself), so this harness configures
 * one of each and sends it on those two calls.
 */
const RUNNER_TOKEN = "test-runner-token";
const ADMIN_TOKEN = "test-admin-token";

beforeAll(async () => {
  const { server } = await createServer({
    runnerTokens: [{ orgId: "demo", token: RUNNER_TOKEN }],
    adminToken: ADMIN_TOKEN,
  });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  close = () => server.close();
});

afterAll(() => close());

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}
async function get(path: string) {
  const res = await fetch(base + path);
  return { status: res.status, json: (await res.json()) as any };
}

describe("API integration (T013/T030/T031 wiring)", () => {
  let scanId: string;

  it("scans the eval repo and reports two-tier counts", async () => {
    const { status, json } = await post("/v1/orgs/demo/scans", { path: "corpus/eval-repos/vulnerable-nextjs-mcp" });
    expect(status).toBe(201);
    expect(json.verified).toBeGreaterThanOrEqual(3);
    expect(json.research).toBeGreaterThanOrEqual(1);
    scanId = json.scanId;
  });

  it("returns findings and SARIF for the scan", async () => {
    const findings = await get(`/v1/scans/${scanId}/findings`);
    expect(findings.json.length).toBeGreaterThan(0);
    const sarif = await get(`/v1/scans/${scanId}/findings.sarif`);
    expect(sarif.json.version).toBe("2.1.0");
  });

  it("lists scan history with real per-scan summaries (dashboard overview)", async () => {
    const { status, json } = await get("/v1/orgs/demo/scans");
    expect(status).toBe(200);
    const entry = json.find((s: { id: string }) => s.id === scanId);
    expect(entry).toBeDefined();
    expect(entry.verified).toBeGreaterThanOrEqual(3);
    expect(entry.createdAt).toBeTruthy();
    expect(Object.keys(entry.bySeverity).length).toBeGreaterThan(0);
  });

  it("the CI gate blocks on verified findings", async () => {
    const { json } = await post(`/v1/scans/${scanId}/gate`, { mode: "block_verified", failureMode: "fail_open" });
    expect(json.conclusion).toBe("failure");
  });

  it("records a dispute for a real finding", async () => {
    const findings = await get(`/v1/scans/${scanId}/findings`);
    const fp = findings.json[0].fingerprint;
    const { json } = await post(`/v1/findings/${fp}/dispute`, { scanId, reason: "false positive" });
    expect(json.ok).toBe(true);
  });

  it("exports evidence traceable to the scan (Scale tier)", async () => {
    const { status, json } = await get(`/v1/orgs/demo/evidence?scanId=${scanId}`);
    expect(status).toBe(200);
    expect(json.every((i: { scanId: string }) => i.scanId === scanId)).toBe(true);
  });

  it("denies evidence export to a free-tier org (403, FR-025)", async () => {
    // seed a scan under the free org
    const created = await post("/v1/orgs/free-org/scans", { path: "corpus/cases/verified/rls-gap/vuln-no-rls/tree" });
    const res = await get(`/v1/orgs/free-org/evidence?scanId=${created.json.scanId}`);
    expect(res.status).toBe(403);
  });

  it("suppresses a disputed finding from later results (FR-011/T087)", async () => {
    // self-contained: free-org has no prior disputes to interfere
    const created = await post("/v1/orgs/free-org/scans", { path: "corpus/eval-repos/vulnerable-nextjs-mcp" });
    const sid = created.json.scanId;
    const findings = await get(`/v1/scans/${sid}/findings`);
    const before = findings.json.length;
    const fp = findings.json[0].fingerprint;
    await post(`/v1/findings/${fp}/dispute`, { scanId: sid, reason: "false positive" });
    const after = await get(`/v1/scans/${sid}/findings`);
    expect(after.json.length).toBe(before - 1);
    const all = await get(`/v1/scans/${sid}/findings?includeSuppressed=1`);
    expect(all.json.length).toBe(before);
  });

  it("returns agent-loop guidance only when enabled (FR-014/T079)", async () => {
    const created = await post("/v1/orgs/no-agent/scans", { path: "corpus/cases/verified/rls-gap/vuln-no-rls/tree" });
    const fp = (await get(`/v1/scans/${created.json.scanId}/findings`)).json[0].fingerprint;
    const denied = await get(`/v1/orgs/no-agent/scans/${created.json.scanId}/agent-guidance?fingerprint=${fp}`);
    expect(denied.status).toBe(403);
    // demo org has it enabled
    const demoScan = await post("/v1/orgs/demo/scans", { path: "corpus/cases/verified/rls-gap/vuln-no-rls/tree" });
    const dfp = (await get(`/v1/scans/${demoScan.json.scanId}/findings`)).json[0].fingerprint;
    const ok = await get(`/v1/orgs/demo/scans/${demoScan.json.scanId}/agent-guidance?fingerprint=${dfp}`);
    expect(ok.status).toBe(200);
    expect(ok.json.guidance).toBeTruthy();
  });

  it("registers and scans an MCP fleet server with posture rollup (FR-024/T085)", async () => {
    const reg = await post("/v1/orgs/demo/fleet/servers", {
      name: "reports-mcp",
      endpointOrRepo: "internal/reports",
      configHash: "h1",
    });
    expect(reg.status).toBe(201);
    await post(`/v1/fleet/servers/${reg.json.id}/rescan`, { path: "corpus/eval-repos/vulnerable-nextjs-mcp" });
    const view = await get("/v1/orgs/demo/fleet");
    expect(view.json.rollup.total).toBeGreaterThanOrEqual(1);
    expect(view.json.servers.some((s: { posture: string }) => s.posture === "critical")).toBe(true);
  });

  it("publishes and serves a public benchmark (FR-018/T046)", async () => {
    const labels = [
      { caseId: "c1", classId: "exposed-secret", label: "vulnerable" },
      { caseId: "c2", classId: "exposed-secret", label: "clean" },
    ];
    const detections = [
      { caseId: "c1", flaggedClassIds: ["exposed-secret"] },
      { caseId: "c2", flaggedClassIds: [] },
    ];
    const pub = await post(
      "/v1/benchmark/publish",
      { tool: "gatepass", corpusVersion: "corpus-v1", labels, detections },
      ADMIN_TOKEN,
    );
    expect(pub.status).toBe(201);
    const view = await get("/v1/public/benchmark/corpus-v1");
    expect(view.json.corpusVersion).toBe("corpus-v1");
    expect(view.json.runs[0].tool).toBe("gatepass");
    const all = await get("/v1/public/benchmark");
    expect(Array.isArray(all.json)).toBe(true);
  });

  it("ingests runner results (findings-only) and rejects source-bearing payloads (T094)", async () => {
    // build a valid findings document from a real scan, then upload it runner-style
    const scanRes = await post("/v1/orgs/demo/scans", {
      path: "corpus/cases/verified/cors-misconfig/vuln-wildcard-creds/tree",
    });
    const findings = (await get(`/v1/scans/${scanRes.json.scanId}/findings`)).json;
    const validDoc = {
      schema: "gatepass.findings/1",
      scan: {
        id: "runner-" + Date.now(),
        rulesetVersion: "2026.07.0",
        executionMode: "runner",
        surfacesScanned: ["app_code"],
      },
      findings,
    };
    const okUpload = await post("/v1/runner/results", { orgId: "demo", document: validDoc }, RUNNER_TOKEN);
    expect(okUpload.status).toBe(201);
    // smuggling source is rejected
    const bad = {
      orgId: "demo",
      document: { ...validDoc, findings: findings.map((f: object) => ({ ...f, content: "SOURCE CODE" })) },
    };
    const badUpload = await post("/v1/runner/results", bad, RUNNER_TOKEN);
    expect(badUpload.status).toBe(422);
  });
});

/**
 * The tenant guard, exercised through `makeHandlers` directly rather than over HTTP.
 *
 * `server.ts` checks tenancy for every `/v1/scans/:id/*` path, and that check stays — it is what
 * covers routes added later. But it is not the only door: `makeHandlers` returns a plain object,
 * and the CLI, workers, and anything else holding one could read any scan by id from any tenant.
 * These assert the guard where that caller would hit it.
 */
describe("scan reads are tenant-scoped inside the handlers, not only at the HTTP layer", () => {
  const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "corpus", "eval-repos");

  async function seed() {
    const store = new MemoryStore();
    await store.upsertOrg({ id: "owner-org", planTier: "scale", llmEnabled: false, agentLoopEnabled: false });
    await store.upsertOrg({ id: "other-org", planTier: "scale", llmEnabled: false, agentLoopEnabled: false });
    const h = makeHandlers(store);
    const { scanId } = await h.createScan("owner-org", resolve(fixture, "vulnerable-nextjs-mcp"));
    return { h, scanId };
  }

  it("lets the owning org read its own scan", async () => {
    const { h, scanId } = await seed();
    await expect(h.getFindings("owner-org", scanId)).resolves.toBeInstanceOf(Array);
    await expect(h.getSarif("owner-org", scanId)).resolves.toBeTruthy();
  });

  it("refuses another org on findings, SARIF and the gate", async () => {
    const { h, scanId } = await seed();
    const gate = { mode: "block_verified", failureMode: "fail_open" } as const;
    await expect(h.getFindings("other-org", scanId)).rejects.toThrow(/does not belong/);
    await expect(h.getSarif("other-org", scanId)).rejects.toThrow(/does not belong/);
    await expect(h.evaluateGate("other-org", scanId, gate)).rejects.toThrow(/does not belong/);
  });

  it("still reports a missing scan as missing rather than as someone else's", async () => {
    const { h } = await seed();
    // Order matters: leaking "that belongs to another org" for an id that does not exist would
    // turn the 403 into an oracle for which scan ids are real.
    await expect(h.getFindings("owner-org", "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/scan /);
  });
});

/**
 * What a scan is *called* once it is stored.
 *
 * The identity is not cosmetic — it is the key the repository-scope check reads and the string
 * the dashboard renders. Seeding the bundled fixture used to record it as an absolute path on
 * whichever machine happened to run the API, which put a developer's home directory on a
 * customer-facing page and named the same fixture differently on every host.
 */
describe("a scanned directory's recorded identity", () => {
  const fixture = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "corpus",
    "eval-repos",
    "vulnerable-nextjs-mcp",
  );

  async function scan(label?: string) {
    const store = new MemoryStore();
    await store.upsertOrg({ id: "demo", planTier: "scale", llmEnabled: false, agentLoopEnabled: false });
    await makeHandlers(store).createScan("demo", fixture, label);
    return (await store.getRepos!("demo"))[0]!;
  }

  it("defaults to the path, so an operator sees exactly what was read", async () => {
    expect((await scan()).name).toBe(fixture);
  });

  it("uses a supplied label, keeping the host's directory layout off the page", async () => {
    const repo = await scan("corpus/eval-repos/vulnerable-nextjs-mcp");
    expect(repo.name).toBe("corpus/eval-repos/vulnerable-nextjs-mcp");
    expect(repo.name).not.toContain("/Users/");
  });

  it("REFUSES a label shaped like a GitHub slug", async () => {
    /*
     * The guard that matters. A local scan recorded as `owner/repo` is indistinguishable from a
     * scan of the real repository of that name — to the dashboard, to the repo-source classifier
     * that decides whether to call the GitHub API, and to the scope check that authorizes access
     * to it by name.
     */
    expect((await scan("modelcontextprotocol/servers")).name).toBe(fixture);
  });

  it("refuses an absolute path as a label", async () => {
    expect((await scan("/etc/passwd")).name).toBe(fixture);
  });
});
