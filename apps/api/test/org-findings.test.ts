import { describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import type { Finding, FindingsDocument } from "@gatepass/findings";
import { parseFindingsDocument } from "@gatepass/findings";
import { createServer } from "../src/server.js";
import { makeHandlers } from "../src/handlers.js";
import { MemoryStore, newRepoRecord } from "../src/store.js";

/**
 * `GET /v1/orgs/:org/findings` — everything that currently stands against an org.
 *
 * ## The bug this route exists to close
 *
 * The dashboard used to answer "what has Gatepass found?" by loading the scan history, taking
 * the single most recent scan, and showing its findings. For an org with one repository that
 * is the same question. For an org with several it is a different one, and the answer depends
 * on which repository happened to be scanned last.
 *
 * That is not hypothetical. The demo seed scans a researched list of public repositories in
 * order, and the list deliberately ends with well-maintained ones that report nothing — the
 * clean half of the precision claim. So the newest scan was clean, the findings page rendered
 * empty, and a deployment holding twenty-three findings across three repositories presented as
 * a scanner that finds nothing. `emptiest scan last` below is that exact shape.
 */

const REPRODUCTION = {
  kind: "inspection" as const,
  steps: ["Open the file at the reported line."],
  expected: "The transport is constructed with no authentication registered.",
};

/**
 * A verified finding, with the reproduction the tier requires.
 *
 * Built through `parseFindingsDocument` in `docFor` below rather than cast past the schema:
 * the constitution's first invariant is that `verified` implies a reproduction, and a test
 * fixture that skips validation is exactly where a violation would go unnoticed.
 */
function verified(fingerprint: string, classId: string, severity: "critical" | "high" | "medium"): Finding {
  return {
    fingerprint,
    classId,
    severity,
    tier: "verified",
    surfaces: ["mcp_server"],
    locations: [{ path: "src/server.ts", startLine: 12, endLine: 12, surface: "mcp_server" }],
    explanation: `${classId} at src/server.ts:12`,
    reproduction: REPRODUCTION,
  };
}

function docFor(scanId: string, findings: Finding[]): FindingsDocument {
  // Validated, so a fixture can never assert something the schema would reject in production.
  return parseFindingsDocument({
    schema: "gatepass.findings/1",
    scan: {
      id: scanId,
      rulesetVersion: "test",
      executionMode: "hosted",
      surfacesScanned: ["mcp_server"],
    },
    findings,
  });
}

interface SeedScan {
  repo: string;
  scanId: string;
  findings: Finding[];
  createdAt: string;
  /** When false the scan is written but the repository is not pointed at it — i.e. history. */
  current?: boolean;
}

async function seed(scans: SeedScan[], orgId = "demo"): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.upsertOrg({ id: orgId, planTier: "scale", llmEnabled: true, agentLoopEnabled: true });
  for (const s of scans) {
    await store.connectRepo(newRepoRecord(orgId, s.repo, { source: "github" }));
    await store.putScan({
      id: s.scanId,
      orgId,
      doc: docFor(s.scanId, s.findings),
      disputes: new Map(),
      createdAt: s.createdAt,
    });
    // `putRepo` moves the repository's `lastScanId` pointer — which is what makes a scan the
    // repository's *current* one. Skipping it leaves the scan in history.
    if (s.current !== false) await store.putRepo(orgId, s.repo, s.scanId, { source: "github" });
  }
  return store;
}

/** The shape the demo seed produces: findings first, then the clean control repositories. */
const DEMO_SHAPE: SeedScan[] = [
  {
    repo: "vercel/ai",
    scanId: "scan-vercel",
    createdAt: "2026-07-30T18:04:19.000Z",
    findings: [
      verified("fp-vercel-1", "unauth-mcp-transport", "high"),
      verified("fp-vercel-2", "unauth-mcp-transport", "critical"),
    ],
  },
  {
    repo: "openai/openai-agents-python",
    scanId: "scan-openai",
    createdAt: "2026-07-30T18:04:22.000Z",
    findings: [verified("fp-openai-1", "unauth-mcp-transport", "high")],
  },
  // Scanned last, and clean — the control half of the precision claim.
  {
    repo: "browserbase/mcp-server-browserbase",
    scanId: "scan-browserbase",
    createdAt: "2026-07-30T18:04:29.000Z",
    findings: [],
  },
];

describe("GET /v1/orgs/:org/findings — the org's current findings", () => {
  it("returns every repository's findings when the newest scan is the clean one", async () => {
    const store = await seed(DEMO_SHAPE);
    const h = await makeHandlers(store, {}).forSession(null);

    const view = await h.listOrgFindings("demo");

    // The regression in one assertion: the old "newest scan only" answer was zero.
    expect(view.findings).toHaveLength(3);
    expect(new Set(view.findings.map((f) => f.repo))).toEqual(
      new Set(["vercel/ai", "openai/openai-agents-python"]),
    );
    // The clean repository is still represented among the scans, so the page can say how many
    // repositories were covered rather than only how many had something wrong.
    expect(view.scans.map((s) => s.repo)).toContain("browserbase/mcp-server-browserbase");
    expect(view.scans).toHaveLength(3);
  });

  it("attributes every finding to the scan and repository it came from", async () => {
    const store = await seed(DEMO_SHAPE);
    const h = await makeHandlers(store, {}).forSession(null);

    const { findings } = await h.listOrgFindings("demo");
    const one = findings.find((f) => f.fingerprint === "fp-openai-1");

    expect(one).toBeDefined();
    expect(one!.scanId).toBe("scan-openai");
    expect(one!.repo).toBe("openai/openai-agents-python");
    // The finding itself is unchanged — attribution is additive, never a rewrite.
    expect(one!.tier).toBe("verified");
    expect(one!.reproduction).toEqual(REPRODUCTION);
  });

  it("returns the scans newest first", async () => {
    const store = await seed(DEMO_SHAPE);
    const h = await makeHandlers(store, {}).forSession(null);

    const { scans } = await h.listOrgFindings("demo");

    expect(scans.map((s) => s.repo)).toEqual([
      "browserbase/mcp-server-browserbase",
      "openai/openai-agents-python",
      "vercel/ai",
    ]);
  });

  it("excludes a repository's older scans, so a fixed vulnerability does not come back", async () => {
    const store = await seed([
      {
        repo: "acme/api",
        scanId: "scan-old",
        createdAt: "2026-07-01T00:00:00.000Z",
        findings: [verified("fp-fixed", "sql-injection", "critical")],
        current: false,
      },
      {
        repo: "acme/api",
        scanId: "scan-new",
        createdAt: "2026-07-20T00:00:00.000Z",
        findings: [verified("fp-open", "unauth-mcp-transport", "high")],
      },
    ]);
    const h = await makeHandlers(store, {}).forSession(null);

    const { findings, scans } = await h.listOrgFindings("demo");

    expect(findings.map((f) => f.fingerprint)).toEqual(["fp-open"]);
    expect(scans.map((s) => s.id)).toEqual(["scan-new"]);
  });

  it("drops a finding that has been disputed org-wide", async () => {
    const store = await seed(DEMO_SHAPE);
    await store.suppress("demo", "fp-vercel-1");
    const h = await makeHandlers(store, {}).forSession(null);

    const { findings } = await h.listOrgFindings("demo");

    expect(findings.map((f) => f.fingerprint)).not.toContain("fp-vercel-1");
    expect(findings).toHaveLength(2);
  });

  it("falls back to the newest scan when no scan is attributable to a repository", async () => {
    // A store whose scans predate repository records — the old behaviour is right here,
    // because there is no better answer available, and an empty page would be wrong.
    const store = new MemoryStore();
    await store.upsertOrg({ id: "demo", planTier: "scale", llmEnabled: true, agentLoopEnabled: true });
    for (const [id, when] of [
      ["scan-a", "2026-07-01T00:00:00.000Z"],
      ["scan-b", "2026-07-02T00:00:00.000Z"],
    ] as const) {
      await store.putScan({
        id,
        orgId: "demo",
        doc: docFor(id, [verified(`fp-${id}`, "unauth-mcp-transport", "high")]),
        disputes: new Map(),
        createdAt: when,
      });
    }
    const h = await makeHandlers(store, {}).forSession(null);

    const { findings, scans } = await h.listOrgFindings("demo");

    expect(scans.map((s) => s.id)).toEqual(["scan-b"]);
    expect(findings.map((f) => f.fingerprint)).toEqual(["fp-scan-b"]);
    expect(findings[0]!.repo).toBeUndefined();
  });

  it("is empty for an org with no scans at all", async () => {
    const store = new MemoryStore();
    await store.upsertOrg({ id: "demo", planTier: "scale", llmEnabled: true, agentLoopEnabled: true });
    const h = await makeHandlers(store, {}).forSession(null);

    await expect(h.listOrgFindings("demo")).resolves.toEqual({ scans: [], findings: [] });
  });
});

describe("GET /v1/orgs/:org/findings — over HTTP", () => {
  it("answers 200 with the attributed findings", async () => {
    const store = await seed(DEMO_SHAPE);
    const { server } = await createServer({ store, seedBenchmark: false });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/orgs/demo/findings`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { scans: unknown[]; findings: Array<{ repo?: string; scanId: string }> };
      expect(body.findings).toHaveLength(3);
      expect(body.scans).toHaveLength(3);
      expect(body.findings.every((f) => typeof f.scanId === "string")).toBe(true);
    } finally {
      server.close();
    }
  });

  it("does not collide with GET /v1/orgs/:org", async () => {
    const store = await seed(DEMO_SHAPE);
    const { server } = await createServer({ store, seedBenchmark: false });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/orgs/demo`);
      expect(res.status).toBe(200);
      const org = (await res.json()) as { id: string };
      expect(org.id).toBe("demo");
    } finally {
      server.close();
    }
  });
});
