import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { AccessGrant, GitHubUser, OrgGrant } from "@gatepass/github";
import { createSession, type Role } from "@gatepass/shared";
import { createServer } from "../src/server.js";
import { MemoryStore, newRepoRecord } from "../src/store.js";

/**
 * Authorization is the server's job, and this file is the proof.
 *
 * The dashboard hides admin controls from a viewer (`useHasRole` in
 * `apps/web/src/providers/SessionProvider.tsx`), and that is presentation, not protection —
 * anybody can call the API directly with curl and never render a page at all. So every
 * privileged action is exercised here **with a real viewer session and no browser involved**,
 * and every one has to be refused by the API itself.
 *
 * The matrix is written route-by-route rather than as a loop over a table because the point is
 * coverage: a route that gains a privileged capability and is not listed here should be
 * conspicuous by its absence.
 */

const SECRET = "sess-secret";
const ORG = "acme";

function session(role: Role, userId = "1"): string {
  return createSession({ userId, login: "octocat", orgId: ORG, role }, SECRET);
}

let base: string;
let close: () => void;

beforeAll(async () => {
  const store = new MemoryStore();
  await store.upsertOrg({ id: ORG, planTier: "scale", llmEnabled: true, agentLoopEnabled: true, fixPrEnabled: true });
  await store.connectRepo(newRepoRecord(ORG, "acme/api", { source: "github" }));
  await store.putScan({
    id: "scan-1",
    orgId: ORG,
    doc: { scan: { id: "scan-1", rulesetVersion: "test" }, findings: [] } as never,
    disputes: new Map(),
    createdAt: new Date().toISOString(),
  });

  const { server } = await createServer({ store, sessionSecret: SECRET });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

afterAll(() => close());

async function call(method: string, path: string, token?: string, body?: unknown): Promise<number> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return res.status;
}

/** Every route that requires more than a viewer, and the least role that may call it. */
const PRIVILEGED: { name: string; method: string; path: string; body?: unknown; needs: Role }[] = [
  {
    name: "change org settings",
    method: "PATCH",
    path: `/v1/orgs/${ORG}/settings`,
    body: { agent_loop_enabled: true },
    needs: "admin",
  },
  {
    name: "change a repo's gate policy",
    method: "PATCH",
    path: `/v1/orgs/${ORG}/repos/${encodeURIComponent("acme/api")}`,
    body: { gate_mode: "off" },
    needs: "admin",
  },
  {
    name: "disconnect a repository",
    method: "DELETE",
    path: `/v1/orgs/${ORG}/repos/${encodeURIComponent("acme/api")}`,
    needs: "admin",
  },
  {
    name: "export evidence to a compliance platform",
    method: "POST",
    path: `/v1/orgs/${ORG}/evidence/export`,
    body: { scanId: "scan-1", platform: "vanta" },
    needs: "admin",
  },
  {
    name: "open a fix pull request against customer code",
    method: "POST",
    path: `/v1/orgs/${ORG}/scans/scan-1/fix-pr`,
    body: {},
    needs: "admin",
  },
  {
    name: "connect a repository",
    method: "POST",
    path: `/v1/orgs/${ORG}/repos`,
    body: { repo: "acme/web" },
    needs: "member",
  },
  {
    name: "scan a repository",
    method: "POST",
    path: `/v1/orgs/${ORG}/scan-remote`,
    body: { repo: "acme/web" },
    needs: "member",
  },
  { name: "run the CI gate", method: "POST", path: "/v1/scans/scan-1/gate", body: { mode: "off" }, needs: "member" },
  {
    name: "dispute a finding",
    method: "POST",
    path: "/v1/findings/abc/dispute",
    body: { scanId: "scan-1", reason: "no" },
    needs: "member",
  },
];

describe("privileged routes are refused server-side, whatever the dashboard renders", () => {
  for (const route of PRIVILEGED) {
    it(`refuses a viewer trying to ${route.name}`, async () => {
      expect(await call(route.method, route.path, session("viewer"), route.body)).toBe(403);
    });
  }

  for (const route of PRIVILEGED.filter((r) => r.needs === "admin")) {
    it(`refuses a member trying to ${route.name}`, async () => {
      expect(await call(route.method, route.path, session("member"), route.body)).toBe(403);
    });
  }

  it("refuses every one of them with no session at all", async () => {
    for (const route of PRIVILEGED) {
      // 401, not 403: nothing was presented, so the answer is "who are you", not "not you".
      expect(await call(route.method, route.path, undefined, route.body), route.name).toBe(401);
    }
  });

  it("refuses reads without a session too, so a hidden page is not the only gate", async () => {
    for (const path of [`/v1/orgs/${ORG}/repos`, `/v1/orgs/${ORG}/scans`, "/v1/scans/scan-1/findings"]) {
      expect(await call("GET", path), path).toBe(401);
    }
  });

  it("does not accept a role the caller simply asserts", async () => {
    // The token is signed; a header is not. `X-Org-Id` and any client-supplied role claim have
    // no standing, which is why the dashboard's proxy strips them rather than forwarding them.
    const res = await fetch(`${base}/v1/orgs/${ORG}/settings`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session("viewer")}`,
        "x-org-id": ORG,
        "x-role": "admin",
      },
      body: JSON.stringify({ agent_loop_enabled: true }),
    });
    expect(res.status).toBe(403);
  });

  it("refuses a token whose signature does not hold, however plausible its claims", async () => {
    const forged = createSession({ userId: "1", login: "octocat", orgId: ORG, role: "admin" }, "not-the-secret");
    expect(await call("PATCH", `/v1/orgs/${ORG}/settings`, forged, { agent_loop_enabled: true })).toBe(401);
  });
});

describe("the role that authorizes is GitHub's current answer, not the token's", () => {
  /**
   * The gap this closes: a session token carries the role its holder had at sign-in and is good
   * for seven days. Somebody demoted from organization owner to member this morning kept
   * changing gate policy and opening fix pull requests until that token expired, because
   * nothing consulted the access Gatepass had already re-resolved minutes later.
   */
  function grantWith(role: Role): (user: GitHubUser) => Promise<AccessGrant> {
    const org: OrgGrant = {
      login: ORG,
      installationId: 7,
      accountType: "Organization",
      role,
      member: true,
      repos: [{ name: "acme/api", permission: role === "admin" ? "admin" : "write" }],
      granularity: "installation",
    };
    return async (user) => ({
      githubUserId: user.githubUserId,
      login: user.login,
      orgs: [org],
      resolvedAt: new Date().toISOString(),
    });
  }

  async function serverWhereGitHubSays(role: Role) {
    const store = new MemoryStore();
    await store.upsertOrg({ id: ORG, planTier: "scale", llmEnabled: true, agentLoopEnabled: true });
    await store.connectRepo(newRepoRecord(ORG, "acme/api", { source: "github" }));
    // The cached grant a sign-in would have written, at the role GitHub reports *now*.
    await store.putUserAccess({
      githubUserId: "1",
      login: "octocat",
      grant: await grantWith(role)({ githubUserId: 1, login: "octocat", accessToken: "t" }),
      accessToken: "t",
      refreshedAt: new Date().toISOString(),
    });

    const { server } = await createServer({
      store,
      sessionSecret: SECRET,
      githubAccess: { resolve: grantWith(role) },
    });
    await new Promise<void>((r) => server.listen(0, r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { url, stop: () => server.close() };
  }

  it("refuses an admin token once GitHub says the holder is only a member", async () => {
    const srv = await serverWhereGitHubSays("member");
    try {
      // The token still says admin, and it is authentic and unexpired.
      const res = await fetch(`${srv.url}/v1/orgs/${ORG}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${session("admin")}` },
        body: JSON.stringify({ agent_loop_enabled: true }),
      });
      expect(res.status).toBe(403);
    } finally {
      srv.stop();
    }
  });

  it("reports the demoted role on /v1/auth/me, so the dashboard stops offering admin controls", async () => {
    const srv = await serverWhereGitHubSays("member");
    try {
      const res = await fetch(`${srv.url}/v1/auth/me`, {
        headers: { authorization: `Bearer ${session("admin")}` },
      });
      // The UI reads its role from here. Leaving it at "admin" would render buttons that 403,
      // which tells the user the wrong thing about what they may do.
      expect(((await res.json()) as { role: string }).role).toBe("member");
    } finally {
      srv.stop();
    }
  });

  it("still lets a genuine admin through", async () => {
    const srv = await serverWhereGitHubSays("admin");
    try {
      const res = await fetch(`${srv.url}/v1/orgs/${ORG}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${session("admin")}` },
        body: JSON.stringify({ agent_loop_enabled: true }),
      });
      expect(res.status).toBe(200);
    } finally {
      srv.stop();
    }
  });
});
