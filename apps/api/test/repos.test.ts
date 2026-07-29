import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GitHubRepoSummary, RepoDirectory } from "@gatepass/github";
import { createServer } from "../src/server.js";

/**
 * Repository connect / configure / disconnect (contracts/api.md §Repositories).
 *
 * The property this file is really guarding is honesty about what Gatepass knows. A repository
 * row used to report the literal `"private"` for every repo, an always-empty `frameworks`, and
 * deployment-default gate columns, none of which had been read from anywhere. A security
 * dashboard that prints "Private" beside a public repository has told its operator something
 * false about their exposure, so the tests below check that unknown fields are *absent* rather
 * than merely falsy.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CORPUS_REPO = resolve(REPO_ROOT, "corpus", "eval-repos", "vulnerable-nextjs-mcp");

async function listen(opts: Parameters<typeof createServer>[0] = {}) {
  const { server } = await createServer({ seedBenchmark: false, ...opts });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

function json(res: Response) {
  return res.json() as Promise<any>;
}
function send(base: string, path: string, method: string, body?: unknown) {
  return fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const seg = (repo: string) => encodeURIComponent(repo);

/** A `RepoDirectory` that answers from fixed data instead of GitHub. */
function stubDirectory(repos: GitHubRepoSummary[], meta?: GitHubRepoSummary): RepoDirectory {
  return {
    listInstallationRepos: async () => repos,
    getRepoMetadata: async (repo: string) => meta ?? repos.find((r) => r.name === repo),
  };
}

describe("repositories — no GitHub App configured", () => {
  let base: string;
  let close: () => void;

  beforeAll(async () => {
    ({ base, close } = await listen());
  });
  afterAll(() => close());

  async function repos(): Promise<any[]> {
    return json(await fetch(`${base}/v1/orgs/demo/repos`));
  }
  const find = async (name: string) => (await repos()).find((r) => r.name === name);

  it("connects a repository by owner/name and lists it", async () => {
    const res = await send(base, "/v1/orgs/demo/repos", "POST", { repo: "acme/widgets" });
    expect(res.status).toBe(201);
    const created = await json(res);
    expect(created.name).toBe("acme/widgets");
    expect(created.source).toBe("github");
    expect(created.scanStatus).toBe("never_scanned");

    expect(await find("acme/widgets")).toBeDefined();
  });

  /*
   * The central honesty property. Nothing asked GitHub what this repository is, so the row
   * carries no `visibility` key at all — not `"private"`, not `null`, not an empty string.
   * An absent key renders as nothing; a wrong value renders as a false claim about exposure.
   */
  it("omits visibility entirely when GitHub was never asked", async () => {
    const created = await json(await send(base, "/v1/orgs/demo/repos", "POST", { repo: "acme/unknown-vis" }));
    expect("visibility" in created).toBe(false);
    expect("defaultBranch" in created).toBe(false);

    const listed = await find("acme/unknown-vis");
    expect("visibility" in listed).toBe(false);
  });

  it("refuses to connect something that is not an owner/name slug", async () => {
    const res = await send(base, "/v1/orgs/demo/repos", "POST", { repo: "/Users/me/proj" });
    expect(res.status).toBe(403);
    expect(String((await json(res)).error)).toMatch(/owner\/name/);
    expect(await find("/Users/me/proj")).toBeUndefined();
  });

  it("is idempotent: reconnecting neither duplicates the row nor resets settings", async () => {
    await send(base, "/v1/orgs/demo/repos", "POST", { repo: "acme/idem" });
    await send(base, `/v1/orgs/demo/repos/${seg("acme/idem")}`, "PATCH", { gate_mode: "block_verified" });

    const second = await send(base, "/v1/orgs/demo/repos", "POST", { repo: "acme/idem" });
    expect(second.status).toBe(201);

    const all = await repos();
    expect(all.filter((r) => r.name === "acme/idem")).toHaveLength(1);
    expect(all.find((r) => r.name === "acme/idem").gateMode).toBe("block_verified");
  });

  it("persists per-repo gate settings across a subsequent read", async () => {
    await send(base, "/v1/orgs/demo/repos", "POST", { repo: "acme/settings" });
    const patched = await send(base, `/v1/orgs/demo/repos/${seg("acme/settings")}`, "PATCH", {
      gate_mode: "block_threshold",
      gate_failure_mode: "fail_closed",
      agent_loop_enabled: true,
    });
    expect(patched.status).toBe(200);

    const row = await find("acme/settings");
    expect(row.gateMode).toBe("block_threshold");
    expect(row.gateFailureMode).toBe("fail_closed");
    expect(row.agentLoopEnabled).toBe(true);
  });

  it("ignores unknown keys and invalid values rather than storing garbage", async () => {
    await send(base, "/v1/orgs/demo/repos", "POST", { repo: "acme/patchguard" });
    const before = await find("acme/patchguard");

    const res = await send(base, `/v1/orgs/demo/repos/${seg("acme/patchguard")}`, "PATCH", {
      gate_mode: "definitely-not-a-mode",
      visibility: "public",
      source: "local_path",
      name: "acme/somewhere-else",
      orgId: "free-org",
    });
    expect(res.status).toBe(200);

    const after = await find("acme/patchguard");
    expect(after.gateMode).toBe(before.gateMode);
    expect(after.name).toBe("acme/patchguard");
    expect(after.source).toBe("github");
    expect("visibility" in after).toBe(false);
  });

  it("404s a PATCH or DELETE of a repository that is not connected", async () => {
    expect((await send(base, `/v1/orgs/demo/repos/${seg("acme/ghost")}`, "PATCH", { gate_mode: "off" })).status).toBe(
      404,
    );
    expect((await send(base, `/v1/orgs/demo/repos/${seg("acme/ghost")}`, "DELETE")).status).toBe(404);
  });

  it("reports the connect flow as unavailable when there is no GitHub App", async () => {
    const available = await json(await fetch(`${base}/v1/orgs/demo/repos/available`));
    expect(available).toEqual({ configured: false, repos: [] });
  });
});

describe("repositories — GitHub App configured", () => {
  let base: string;
  let close: () => void;

  const INSTALLATION: GitHubRepoSummary[] = [
    { githubRepoId: 7, name: "acme/widgets", visibility: "public", defaultBranch: "main" },
    { githubRepoId: 8, name: "acme/secrets", visibility: "private", defaultBranch: "trunk" },
  ];

  beforeAll(async () => {
    ({ base, close } = await listen({ repoDirectory: stubDirectory(INSTALLATION) }));
  });
  afterAll(() => close());

  it("records the visibility GitHub reported, not a guess", async () => {
    const created = await json(await send(base, "/v1/orgs/demo/repos", "POST", { repo: "acme/widgets" }));
    expect(created.visibility).toBe("public");
    expect(created.defaultBranch).toBe("main");

    const listed = (await json(await fetch(`${base}/v1/orgs/demo/repos`))).find((r: any) => r.name === "acme/widgets");
    expect(listed.visibility).toBe("public");
  });

  it("carries a private repository through as private", async () => {
    const created = await json(await send(base, "/v1/orgs/demo/repos", "POST", { repo: "acme/secrets" }));
    expect(created.visibility).toBe("private");
    expect(created.defaultBranch).toBe("trunk");
  });

  it("connects without metadata when the lookup fails, rather than failing the connect", async () => {
    const srv = await listen({
      repoDirectory: {
        listInstallationRepos: async () => [],
        getRepoMetadata: async () => {
          throw new Error("GitHub is down");
        },
      },
    });
    try {
      const res = await send(srv.base, "/v1/orgs/demo/repos", "POST", { repo: "acme/outage" });
      expect(res.status).toBe(201);
      const created = await json(res);
      expect(created.name).toBe("acme/outage");
      // An outage costs us the metadata; it must not invent one.
      expect("visibility" in created).toBe(false);
    } finally {
      srv.close();
    }
  });

  it("lists installation repositories that are not connected yet, and excludes those that are", async () => {
    const before = await json(await fetch(`${base}/v1/orgs/demo/repos/available`));
    expect(before.configured).toBe(true);
    // acme/widgets and acme/secrets were connected by the tests above.
    expect(before.repos.map((r: GitHubRepoSummary) => r.name)).not.toContain("acme/widgets");
    expect(before.repos.map((r: GitHubRepoSummary) => r.name)).not.toContain("acme/secrets");

    const fresh = await listen({ repoDirectory: stubDirectory(INSTALLATION) });
    try {
      const available = await json(await fetch(`${fresh.base}/v1/orgs/demo/repos/available`));
      expect(available.configured).toBe(true);
      expect(available.repos.map((r: GitHubRepoSummary) => r.name)).toEqual(["acme/widgets", "acme/secrets"]);

      await send(fresh.base, "/v1/orgs/demo/repos", "POST", { repo: "acme/widgets" });
      const after = await json(await fetch(`${fresh.base}/v1/orgs/demo/repos/available`));
      expect(after.repos.map((r: GitHubRepoSummary) => r.name)).toEqual(["acme/secrets"]);
    } finally {
      fresh.close();
    }
  });
});

describe("repositories and scans", () => {
  let base: string;
  let close: () => void;
  let frameworkDir: string;

  beforeAll(async () => {
    ({ base, close } = await listen());
    frameworkDir = mkdtempSync(join(tmpdir(), "gp-repos-fw-"));
    writeFileSync(
      join(frameworkDir, "package.json"),
      JSON.stringify({ name: "scanned-app", dependencies: { next: "^15.0.0" } }, null, 2),
    );
    writeFileSync(join(frameworkDir, "index.js"), "export const ok = true;\n");
  });
  afterAll(() => close());

  const repos = async (): Promise<any[]> => json(await fetch(`${base}/v1/orgs/demo/repos`));

  it("connects a local directory implicitly when it is scanned", async () => {
    if (!existsSync(CORPUS_REPO)) return; // fixture-less checkout: nothing to assert against
    const res = await send(base, "/v1/orgs/demo/scans", "POST", { path: CORPUS_REPO });
    expect(res.status).toBe(201);
    const { scanId } = await json(res);

    const row = (await repos()).find((r) => r.name === CORPUS_REPO);
    expect(row).toBeDefined();
    expect(row.source).toBe("local_path");
    expect(row.scanStatus).toBe("complete");
    expect(row.lastScanId).toBe(scanId);
    // Never read from GitHub, so still unlabelled.
    expect("visibility" in row).toBe(false);
  });

  it("fills in the frameworks the scan actually detected", async () => {
    const res = await send(base, "/v1/orgs/demo/scans", "POST", { path: frameworkDir });
    expect(res.status).toBe(201);
    const summary = await json(res);
    expect(summary.frameworks).toContain("nextjs");

    // The repos table reads the stored value — this column used to be a hardcoded [].
    const row = (await repos()).find((r) => r.name === frameworkDir);
    expect(row.frameworks).toEqual(summary.frameworks);
    expect(row.frameworks.length).toBeGreaterThan(0);
  });

  it("a rescan updates observations without resetting operator settings", async () => {
    await send(base, `/v1/orgs/demo/repos/${seg(frameworkDir)}`, "PATCH", {
      gate_mode: "block_verified",
      gate_failure_mode: "fail_closed",
    });
    await send(base, "/v1/orgs/demo/scans", "POST", { path: frameworkDir });

    const row = (await repos()).find((r) => r.name === frameworkDir);
    expect(row.gateMode).toBe("block_verified");
    expect(row.gateFailureMode).toBe("fail_closed");
  });

  it("disconnecting removes the repository but keeps the scan history it produced", async () => {
    const created = await json(await send(base, "/v1/orgs/demo/scans", "POST", { path: frameworkDir }));
    const scanId: string = created.scanId;
    expect((await fetch(`${base}/v1/scans/${scanId}/findings`)).status).toBe(200);

    const del = await send(base, `/v1/orgs/demo/repos/${seg(frameworkDir)}`, "DELETE");
    expect(del.status).toBe(200);
    expect((await json(del)).disconnected).toBe(frameworkDir);

    expect((await repos()).find((r) => r.name === frameworkDir)).toBeUndefined();
    // Disconnecting is not a claim that the history did not happen.
    expect((await fetch(`${base}/v1/scans/${scanId}/findings`)).status).toBe(200);
  });
});

describe("repositories — a name containing a literal percent sign", () => {
  let base: string;
  let close: () => void;
  let weirdDir: string;

  beforeAll(async () => {
    ({ base, close } = await listen());
    // `mkdtemp` will not produce a `%`, so the directory is created explicitly.
    weirdDir = join(mkdtempSync(join(tmpdir(), "gatepass-pct-")), "my%20proj");
    mkdirSync(weirdDir, { recursive: true });
    writeFileSync(join(weirdDir, "package.json"), JSON.stringify({ name: "pct", dependencies: { next: "15.0.0" } }));
    await send(base, "/v1/orgs/demo/scans", "POST", { path: weirdDir });
  });
  afterAll(() => close());

  /*
   * Regression: `PATCH` and `DELETE` decoded the `:repo` segment a second time, after `handle`
   * had already decoded every segment. A correctly-encoded `my%2520proj` therefore addressed
   * `my proj`, and the repository became impossible to configure or disconnect — or, worse,
   * the second decode landed on a different record. Scan targets are arbitrary caller-supplied
   * paths, so this was reachable rather than theoretical.
   */
  it("can be configured and disconnected — the segment is decoded exactly once", async () => {
    const patch = await send(base, `/v1/orgs/demo/repos/${seg(weirdDir)}`, "PATCH", { gate_mode: "block_verified" });
    expect(patch.status).toBe(200);
    expect((await json(patch)).name).toBe(weirdDir);

    const listed = await json(await fetch(`${base}/v1/orgs/demo/repos`));
    expect(listed.find((r: any) => r.name === weirdDir).gateMode).toBe("block_verified");

    const del = await send(base, `/v1/orgs/demo/repos/${seg(weirdDir)}`, "DELETE");
    expect(del.status).toBe(200);
    expect((await json(del)).disconnected).toBe(weirdDir);
  });
});
