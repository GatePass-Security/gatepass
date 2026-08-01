import { describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import type { AccessGrant, GitHubUser, OrgGrant, RepoPermission } from "@gatepass/github";
import { createSession, type Session } from "@gatepass/shared";
import { createServer } from "../src/server.js";
import { MemoryStore, newRepoRecord } from "../src/store.js";
import { AccessDirectory } from "../src/access.js";
import { makeHandlers } from "../src/handlers.js";

/**
 * The access model, tested as the promise it makes: *anyone with collaborator access on a
 * repository can use Gatepass for that repository, and sees nothing else.*
 *
 * Two people appear throughout. `octocat` collaborates on one repository of a three-repository
 * org. `owner` owns the org. Nearly every test is the same shape — do the thing as octocat,
 * check that `acme/secret` is not in the answer — because that is the property that has to hold
 * on every surface, and a hole in any one of them is the whole leak.
 */

const OAUTH = { clientId: "cid", clientSecret: "sec", redirectUri: "https://app/cb" };
const SECRET = "sess-secret";

/** GitHub OAuth stubbed at the token exchange and the profile lookup. */
function oauthFetchFor(login: string, id: number): typeof fetch {
  return (async (url: string) => {
    if (String(url).includes("access_token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "gho_test" }) };
    }
    return { ok: true, status: 200, json: async () => ({ id, login }) };
  }) as unknown as typeof fetch;
}

function org(login: string, repos: [string, RepoPermission][], role: OrgGrant["role"] = "member"): OrgGrant {
  return {
    login,
    installationId: 7,
    accountType: "Organization",
    role,
    member: role !== "viewer",
    repos: repos.map(([name, permission]) => ({ name, permission })),
    granularity: "installation",
  };
}

/** A resolver that returns a fixed grant per login, standing in for GitHub. */
function resolverFor(byLogin: Record<string, OrgGrant[]>) {
  return async (user: GitHubUser): Promise<AccessGrant> => ({
    githubUserId: user.githubUserId,
    login: user.login,
    orgs: byLogin[user.login] ?? [],
    resolvedAt: new Date().toISOString(),
  });
}

const GRANTS: Record<string, OrgGrant[]> = {
  // A collaborator on exactly one repository. Not a member of the org.
  octocat: [{ ...org("acme", [["acme/api", "write"]]), member: false, role: "member" }],
  // The org owner, whose installation covers all three.
  owner: [
    org(
      "acme",
      [
        ["acme/api", "admin"],
        ["acme/web", "admin"],
        ["acme/secret", "admin"],
      ],
      "admin",
    ),
  ],
  // Somebody whose organizations have not installed Gatepass at all.
  stranger: [],
  // Reaches two orgs, for the switcher.
  consultant: [org("acme", [["acme/api", "write"]]), org("beta", [["beta/site", "write"]])],
};

/** A store pre-loaded with the org's three repositories and one scan per repository. */
async function seededStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.upsertOrg({ id: "acme", planTier: "scale", llmEnabled: true, agentLoopEnabled: true });
  for (const name of ["acme/api", "acme/web", "acme/secret"]) {
    await store.connectRepo(newRepoRecord("acme", name, { source: "github" }));
    const scanId = `scan-${name.split("/")[1]}`;
    await store.putScan({
      id: scanId,
      orgId: "acme",
      doc: { scan: { id: scanId, rulesetVersion: "test" }, findings: [] } as never,
      disputes: new Map(),
      createdAt: new Date().toISOString(),
    });
    await store.putRepo("acme", name, scanId, { source: "github" });
  }
  return store;
}

function directoryFor(store: MemoryStore): AccessDirectory {
  return new AccessDirectory(store, { resolve: resolverFor(GRANTS) });
}

/**
 * A fix-PR client that refuses every call.
 *
 * Wired only so the fix-PR route gets past "this deployment cannot write to repositories at
 * all" and reaches the access check. Every method throwing is the assertion: if the scope
 * check ever stops firing first, the test fails loudly instead of quietly opening a PR.
 */
const refusingFixPrClient = new Proxy(
  {},
  {
    get() {
      return () => {
        throw new Error("the fix-PR client must not be reached for a repository outside the grant");
      };
    },
  },
) as never;

/** Handlers scoped to `login`, with that person's grant already recorded. */
async function handlersFor(store: MemoryStore, login: string, id = 1) {
  const accessDirectory = directoryFor(store);
  await accessDirectory.record({ githubUserId: id, login, accessToken: "gho_test" });
  const h = makeHandlers(store, {
    accessDirectory,
    sessionSecret: SECRET,
    sessionOrgId: "acme",
    fixPrClient: refusingFixPrClient,
  });
  const session: Session = {
    userId: String(id),
    login,
    orgId: "acme",
    role: "member",
    jti: `jti-${login}`,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  return { h, scoped: await h.forSession(session), session, accessDirectory };
}

describe("a collaborator sees their repositories and no others", () => {
  it("lists only the repository they collaborate on", async () => {
    const store = await seededStore();
    const { scoped } = await handlersFor(store, "octocat");

    expect((await scoped.listRepos("acme")).map((r) => r.name)).toEqual(["acme/api"]);
  });

  it("lets the org owner see all three", async () => {
    const store = await seededStore();
    const { scoped } = await handlersFor(store, "owner", 2);

    expect((await scoped.listRepos("acme")).map((r) => r.name)).toEqual(["acme/api", "acme/web", "acme/secret"]);
  });

  it("hides other repositories' scans from the history", async () => {
    const store = await seededStore();
    const { scoped } = await handlersFor(store, "octocat");

    const scans = await scoped.listScans("acme");
    expect(scans.map((s) => s.repo)).toEqual(["acme/api"]);
    /*
     * Filtered, not merely unlabelled. A scan left in this list with its repo blanked out
     * still hands over the scan id, and the scan id is what the next request uses to read the
     * findings — so hiding the name while publishing the key would leak everything anyway.
     */
    expect(scans.some((s) => s.id === "scan-secret")).toBe(false);
  });

  it("scopes the org-wide findings list to the repositories they may see", async () => {
    const store = await seededStore();
    const { scoped } = await handlersFor(store, "octocat");

    // `GET /v1/orgs/:org/findings` spans repositories by design, which makes it the one route
    // where a missed scope check would hand over every tenant repository at once.
    const view = await scoped.listOrgFindings("acme");
    expect(view.scans.map((s) => s.repo)).toEqual(["acme/api"]);
    expect(view.scans.some((s) => s.id === "scan-secret")).toBe(false);
    expect(view.findings.every((f) => f.repo === "acme/api")).toBe(true);
  });

  it("gives the owner the org-wide findings list across all three", async () => {
    const store = await seededStore();
    const { scoped } = await handlersFor(store, "owner", 2);

    const view = await scoped.listOrgFindings("acme");
    expect(new Set(view.scans.map((s) => s.repo))).toEqual(new Set(["acme/api", "acme/web", "acme/secret"]));
  });

  it("refuses findings for a scan of a repository they cannot see", async () => {
    const store = await seededStore();
    const { scoped } = await handlersFor(store, "octocat");

    await expect(scoped.getFindings("acme", "scan-secret")).rejects.toThrow(/scan scan-secret/);
    // …and answers normally for the one they can.
    await expect(scoped.getFindings("acme", "scan-api")).resolves.toEqual([]);
  });

  it("refuses SARIF and the gate for the same scan", async () => {
    const store = await seededStore();
    const { scoped } = await handlersFor(store, "octocat");

    await expect(scoped.getSarif("acme", "scan-secret")).rejects.toThrow();
    await expect(
      scoped.evaluateGate("acme", "scan-secret", { mode: "block_verified", failureMode: "fail_open" }),
    ).rejects.toThrow();
  });

  it("answers 'not found' rather than 'forbidden' for a scan out of scope", async () => {
    const store = await seededStore();
    const { scoped } = await handlersFor(store, "octocat");

    // A 403 would confirm the scan exists and belongs to this org, which is exactly what
    // somebody probing scan ids is trying to learn.
    await expect(scoped.getFindings("acme", "scan-secret")).rejects.toMatchObject({ name: "Error" });
    const err = await scoped.getFindings("acme", "scan-secret").catch((e) => e);
    expect(err.constructor.name).toBe("NotFoundError");
  });

  it("refuses to connect, reconfigure or disconnect a repository outside the grant", async () => {
    const store = await seededStore();
    const { scoped } = await handlersFor(store, "octocat");

    await expect(scoped.connectRepo("acme", "acme/secret")).rejects.toThrow(/do not have access/);
    await expect(scoped.updateRepoSettings("acme", "acme/secret", { gate_mode: "off" })).rejects.toThrow(
      /do not have access/,
    );
    await expect(scoped.disconnectRepo("acme", "acme/secret")).rejects.toThrow(/do not have access/);
  });

  it("refuses to scan a repository outside the grant", async () => {
    const store = await seededStore();
    const { scoped } = await handlersFor(store, "octocat");

    await expect(scoped.scanRemoteRepo("acme", "acme/secret")).rejects.toThrow(/do not have access/);
  });

  it("refuses to scan an arbitrary directory on the API host", async () => {
    const store = await seededStore();
    const { scoped } = await handlersFor(store, "octocat");

    /*
     * `createScan` takes a path, and under a GitHub-derived scope the caller's access is a set
     * of repositories GitHub vouched for — a directory on the server is not one of them. Left
     * open, this route would point the scanner at anything the API process can read.
     */
    await expect(scoped.createScan("acme", "/etc")).rejects.toThrow(/do not have access/);
    await expect(scoped.complianceScan("acme", "/etc")).rejects.toThrow(/do not have access/);
  });

  it("refuses a fix pull request against a repository named in the request but not in the grant", async () => {
    const store = await seededStore();
    await store.upsertOrg({
      id: "acme",
      planTier: "scale",
      llmEnabled: true,
      agentLoopEnabled: true,
      fixPrEnabled: true,
    });
    const { scoped } = await handlersFor(store, "octocat");

    /*
     * `opts.repo` lets a caller name a repository other than the scan's. This is the only
     * route in the API that writes to a customer repository, so the check has to be against
     * the repository about to be written to — not against the scan that justified it.
     */
    await expect(scoped.openFixPullRequest("acme", "scan-api", { repo: "acme/secret" })).rejects.toThrow(
      /do not have access/,
    );
  });
});

describe("deployments that do not derive access from GitHub are unchanged", () => {
  it("places no repository restriction when there is no access directory", async () => {
    const store = await seededStore();
    const h = makeHandlers(store, { sessionSecret: SECRET, sessionOrgId: "acme" });
    const session: Session = {
      userId: "1",
      login: "octocat",
      orgId: "acme",
      role: "member",
      jti: "j",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    /*
     * The failure mode this guards against is the opposite of the rest of the file: a scope
     * that defaults to *empty* rather than to *unrestricted* would lock every allow-list and
     * CLI deployment out of its own data on upgrade.
     */
    const scoped = await h.forSession(session);
    expect((await scoped.listRepos("acme")).map((r) => r.name)).toHaveLength(3);
  });

  it("places no restriction on a session the directory has no grant for", async () => {
    const store = await seededStore();
    // A development sign-in, or an allow-listed operator: a real session, no GitHub grant.
    const { h } = await handlersFor(store, "octocat");
    const devSession: Session = {
      userId: "dev:someone",
      login: "someone",
      orgId: "acme",
      role: "admin",
      jti: "j2",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const scoped = await h.forSession(devSession);
    expect((await scoped.listRepos("acme")).map((r) => r.name)).toHaveLength(3);
  });
});

describe("admission is reaching a GitHub org that has Gatepass", () => {
  async function listen(login: string, id: number, store?: MemoryStore) {
    const { server } = await createServer({
      store: store ?? (await seededStore()),
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      oauthFetch: oauthFetchFor(login, id),
      githubAccess: { resolve: resolverFor(GRANTS) },
    });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;
    return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
  }

  async function signIn(base: string) {
    const res = await fetch(`${base}/v1/auth/github/callback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "thecode" }),
    });
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  }

  it("admits a collaborator into the org whose installation covers their repository", async () => {
    const srv = await listen("octocat", 1);
    try {
      const { status, json } = await signIn(srv.base);
      expect(status).toBe(200);
      expect(json.orgId).toBe("acme");
      expect(json.orgs).toEqual([{ id: "acme", role: "member", repoCount: 1 }]);
    } finally {
      srv.close();
    }
  });

  it("refuses somebody whose organizations have not installed Gatepass, and says what to do", async () => {
    const srv = await listen("stranger", 9);
    try {
      const { status, json } = await signIn(srv.base);
      expect(status).toBe(403);
      // The one refusal an ordinary user will actually see, so it names the action they can
      // take rather than configuration they cannot reach.
      expect(String(json.error)).toMatch(/not installed on any GitHub organization/i);
      expect(String(json.error)).toMatch(/collaborator access/i);
    } finally {
      srv.close();
    }
  });

  it("provisions the tenant from the installation, with no operator step", async () => {
    const store = new MemoryStore();
    const srv = await listen("octocat", 1, store);
    try {
      await signIn(srv.base);
      const provisioned = await store.getOrg("acme");
      expect(provisioned?.githubOrgLogin).toBe("acme");
      expect(provisioned?.installationId).toBe(7);
    } finally {
      srv.close();
    }
  });

  it("reports every org the account reaches, and switches between them", async () => {
    const store = await seededStore();
    const srv = await listen("consultant", 5, store);
    try {
      const { json } = await signIn(srv.base);
      const token = String(json.token);

      const me = await fetch(`${srv.base}/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
      const body = (await me.json()) as Record<string, any>;
      expect(body.orgs.map((o: { id: string }) => o.id)).toEqual(["acme", "beta"]);

      const switched = await fetch(`${srv.base}/v1/auth/switch-org`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId: "beta" }),
      });
      expect(switched.status).toBe(200);
      expect(((await switched.json()) as Record<string, any>).orgId).toBe("beta");
    } finally {
      srv.close();
    }
  });

  it("refuses to switch into an org the account does not reach", async () => {
    const store = await seededStore();
    const srv = await listen("octocat", 1, store);
    try {
      const { json } = await signIn(srv.base);
      const res = await fetch(`${srv.base}/v1/auth/switch-org`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${json.token}` },
        body: JSON.stringify({ orgId: "beta" }),
      });
      // Switching orgs must not become a self-service way to mint a session for any tenant
      // whose id you can guess.
      expect(res.status).toBe(403);
    } finally {
      srv.close();
    }
  });
});

describe("an allow-listed operator still gets in when GitHub grants nothing", () => {
  /**
   * The configuration a deployment actually upgrades from: a classic OAuth App, a personal
   * GitHub account, no installation anywhere — and `GATEPASS_ALLOWED_LOGINS` naming the person
   * who runs it.
   *
   * Turning GitHub-derived access on must not lock that operator out of their own instance.
   * The allow-list is consulted *after* GitHub produces nothing, so it stays the escape hatch
   * it was, and the session it opens is the unrestricted single-org one — because there is no
   * grant to narrow by, and inventing an empty one would be the same lockout by another route.
   */
  it("admits them to the configured org with no repository restriction", async () => {
    const store = await seededStore();
    const { server } = await createServer({
      store,
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      oauthFetch: oauthFetchFor("stranger", 9),
      githubAccess: { resolve: resolverFor(GRANTS) }, // resolves to zero orgs for `stranger`
      allowedLogins: [{ login: "stranger", role: "admin" }],
      sessionOrgId: "acme",
    });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    try {
      const res = await fetch(`${base}/v1/auth/github/callback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "thecode" }),
      });
      const json = (await res.json()) as Record<string, any>;
      expect(res.status, JSON.stringify(json)).toBe(200);
      expect(json.orgId).toBe("acme");
      expect(json.role).toBe("admin");

      const repos = await fetch(`${base}/v1/orgs/acme/repos`, {
        headers: { authorization: `Bearer ${json.token}` },
      });
      expect(((await repos.json()) as unknown[]).length).toBe(3);
    } finally {
      server.close();
    }
  });
});

describe("the cached grant", () => {
  it("is dropped, with the stored GitHub token, on sign-out", async () => {
    const store = await seededStore();
    const { h, accessDirectory } = await handlersFor(store, "octocat");
    expect(await store.getUserAccess("1")).toBeDefined();

    const token = createSession({ userId: "1", login: "octocat", orgId: "acme", role: "member" }, SECRET);
    await h.signOut(token);

    // Holding a live GitHub credential for someone who has ended their session is worth
    // nothing to us and a great deal to whoever reads the database.
    expect(await store.getUserAccess("1")).toBeUndefined();
    expect(await accessDirectory.forUser("1")).toBeUndefined();
  });

  it("is not read as permission when the stored row is not a grant", async () => {
    const store = await seededStore();
    const directory = directoryFor(store);
    await store.putUserAccess({
      githubUserId: "1",
      login: "octocat",
      grant: { orgs: "not-an-array" } as never,
      refreshedAt: new Date().toISOString(),
    });

    // A cache that cannot be read must never read as permission.
    expect(await directory.forUser("1")).toBeUndefined();
  });

  it("re-resolves once it is older than the TTL", async () => {
    const store = await seededStore();
    let calls = 0;
    const directory = new AccessDirectory(store, {
      ttlSec: 60,
      resolve: async (user) => {
        calls++;
        return { githubUserId: user.githubUserId, login: user.login, orgs: GRANTS.octocat!, resolvedAt: "" };
      },
    });
    await directory.record({ githubUserId: 1, login: "octocat", accessToken: "gho" });
    expect(calls).toBe(1);

    await directory.forUser("1");
    expect(calls, "a fresh grant is not re-resolved").toBe(1);

    // Age the cached row past the TTL. A cached grant is precisely access GitHub may already
    // have taken away, which is why the window is minutes rather than the session's days.
    const stale = (await store.getUserAccess("1"))!;
    await store.putUserAccess({
      ...stale,
      grant: stale.grant as never,
      refreshedAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    await directory.forUser("1");
    expect(calls).toBe(2);
  });

  it("keeps the last known grant when a refresh fails", async () => {
    const store = await seededStore();
    let first = true;
    const directory = new AccessDirectory(store, {
      ttlSec: 0,
      resolve: async (user) => {
        if (!first) throw new Error("GitHub is down");
        first = false;
        return { githubUserId: user.githubUserId, login: user.login, orgs: GRANTS.octocat!, resolvedAt: "" };
      },
    });
    await directory.record({ githubUserId: 1, login: "octocat", accessToken: "gho" });

    /*
     * Deliberately the opposite direction from every other failure in this system. Refusing to
     * *widen* on a failed lookup protects the data; refusing to *keep* an already-established
     * grant just signs everybody out during a GitHub incident, and the grant still dies with
     * the session.
     */
    expect((await directory.forUser("1"))?.orgs.map((o) => o.login)).toEqual(["acme"]);
  });
});
