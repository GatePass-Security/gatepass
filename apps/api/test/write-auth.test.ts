import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";
import { parseRunnerTokens } from "../src/tokens.js";

/**
 * Auth on the two write endpoints that no browser session covers.
 *
 * Before this, both accepted anonymous writes: `POST /v1/runner/results` took
 * the target org from the request body, so anyone could inject findings into
 * any org's scan history, and `POST /v1/benchmark/publish` let anyone write
 * arbitrary precision numbers to the public benchmark.
 *
 * The cases that matter most here are the cross-org one (a valid token for org
 * A must not write into org B) and the fail-closed one (an unconfigured
 * deployment must reject, not fall back to the old open behaviour).
 */

const RUNNER_TOKEN = "runner-secret-for-demo";
const OTHER_TOKEN = "runner-secret-for-free-org";
const ADMIN_TOKEN = "admin-secret";

/** Minimal upload that satisfies the runner schema (see apps/api/test/api.test.ts). */
function doc(scanId: string) {
  return {
    schema: "gatepass.findings/1",
    scan: {
      id: scanId,
      rulesetVersion: "2026.07.0",
      executionMode: "runner",
      surfacesScanned: ["app_code"],
    },
    findings: [] as unknown[],
  };
}

const validDoc = doc("runner-scan-1");

async function listen(opts: Parameters<typeof createServer>[0]) {
  const { server } = await createServer(opts);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

function post(base: string, path: string, body: unknown, token?: string) {
  return fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: (await res.json()) as Record<string, unknown> }));
}

describe("parseRunnerTokens", () => {
  it("parses comma-separated orgId:token pairs", () => {
    expect(parseRunnerTokens("a:one,b:two")).toEqual([
      { orgId: "a", token: "one" },
      { orgId: "b", token: "two" },
    ]);
  });

  it("tolerates whitespace and drops malformed pairs instead of throwing", () => {
    expect(parseRunnerTokens(" a : one , garbage , :nope , b:two ")).toEqual([
      { orgId: "a", token: "one" },
      { orgId: "b", token: "two" },
    ]);
  });

  it("treats a token containing a colon as part of the token", () => {
    expect(parseRunnerTokens("a:tok:en:with:colons")).toEqual([{ orgId: "a", token: "tok:en:with:colons" }]);
  });

  it("returns nothing for absent or empty config", () => {
    expect(parseRunnerTokens(undefined)).toEqual([]);
    expect(parseRunnerTokens("   ")).toEqual([]);
  });
});

describe("write endpoints — configured", () => {
  let base: string;
  let close: () => void;

  beforeAll(async () => {
    ({ base, close } = await listen({
      seedBenchmark: false,
      runnerTokens: [
        { orgId: "demo", token: RUNNER_TOKEN },
        { orgId: "free-org", token: OTHER_TOKEN },
      ],
      adminToken: ADMIN_TOKEN,
    }));
  });

  afterAll(() => close());

  describe("POST /v1/runner/results", () => {
    it("401s with no Authorization header", async () => {
      const res = await post(base, "/v1/runner/results", { orgId: "demo", document: validDoc });
      expect(res.status).toBe(401);
    });

    it("401s on a wrong token", async () => {
      const res = await post(base, "/v1/runner/results", { orgId: "demo", document: validDoc }, "not-the-token");
      expect(res.status).toBe(401);
    });

    it("401s on a malformed Authorization header", async () => {
      const res = await fetch(`${base}/v1/runner/results`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: RUNNER_TOKEN },
        body: JSON.stringify({ document: validDoc }),
      });
      expect(res.status).toBe(401);
    });

    it("accepts a valid token and derives the org from it, not the body", async () => {
      const res = await post(base, "/v1/runner/results", { document: validDoc }, RUNNER_TOKEN);
      expect(res.status).toBe(201);
      expect(res.json.scanId).toBe("runner-scan-1");

      // The scan landed under the token's org.
      const findings = await fetch(`${base}/v1/scans/runner-scan-1/findings`);
      expect(findings.status).toBe(200);
    });

    it("403s when the payload names an org the token is not scoped to", async () => {
      const res = await post(
        base,
        "/v1/runner/results",
        { orgId: "demo", document: doc("cross-org-scan") },
        OTHER_TOKEN,
      );
      expect(res.status).toBe(403);

      // …and the scan does not exist, so nothing was written anywhere.
      const leaked = await fetch(`${base}/v1/scans/cross-org-scan/findings`);
      expect(leaked.status).toBe(404);
    });

    it("still rejects a payload carrying source code, even with a valid token", async () => {
      const res = await post(
        base,
        "/v1/runner/results",
        { document: { ...doc("smuggle-scan"), findings: [{ content: "SOURCE CODE" }] } },
        RUNNER_TOKEN,
      );
      expect(res.status).toBe(422);
    });
  });

  describe("POST /v1/benchmark/publish", () => {
    const payload = { tool: "attacker", corpusVersion: "corpus-v1", labels: [], detections: [] };

    it("401s with no token", async () => {
      expect((await post(base, "/v1/benchmark/publish", payload)).status).toBe(401);
    });

    it("401s on a wrong token", async () => {
      expect((await post(base, "/v1/benchmark/publish", payload, "guess")).status).toBe(401);
    });

    it("does not publish anything on a rejected write", async () => {
      await post(base, "/v1/benchmark/publish", payload);
      const published = await fetch(`${base}/v1/public/benchmark`).then((r) => r.json());
      expect(JSON.stringify(published)).not.toContain("attacker");
    });

    it("accepts the admin token", async () => {
      const res = await post(
        base,
        "/v1/benchmark/publish",
        { tool: "gatepass", corpusVersion: "corpus-v1", labels: [], detections: [] },
        ADMIN_TOKEN,
      );
      expect(res.status).toBe(201);
    });
  });
});

describe("write endpoints — unconfigured (fail closed)", () => {
  let base: string;
  let close: () => void;

  beforeAll(async () => {
    ({ base, close } = await listen({ seedBenchmark: false }));
  });

  afterAll(() => close());

  it("rejects runner uploads when no runner tokens are configured", async () => {
    const res = await post(base, "/v1/runner/results", { orgId: "demo", document: validDoc });
    expect(res.status).toBe(401);
    expect(String(res.json.error)).toMatch(/not enabled/i);
  });

  it("rejects runner uploads even when a token is presented", async () => {
    const res = await post(base, "/v1/runner/results", { document: validDoc }, RUNNER_TOKEN);
    expect(res.status).toBe(401);
  });

  it("rejects benchmark publishing when no admin token is configured", async () => {
    const res = await post(base, "/v1/benchmark/publish", {
      tool: "x",
      corpusVersion: "corpus-v1",
      labels: [],
      detections: [],
    });
    expect(res.status).toBe(401);
    expect(String(res.json.error)).toMatch(/not enabled/i);
  });
});
