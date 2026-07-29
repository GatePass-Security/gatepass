import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, type Role, type Session } from "@gatepass/shared";
import { createServer } from "../src/server.js";
import { devAuthEnabled, parseAllowedLogins, requiredRole, resolveOrgId, type RequestAuth } from "../src/auth.js";

/**
 * Fake GitHub OAuth.
 *
 * Three branches, matched in order: the token exchange, the org-membership lookup
 * (`GET /user/memberships/orgs/:org`), and the user profile. The membership branch has to come
 * first because its URL also contains `/user`.
 *
 * `membership: undefined` ⇒ the membership endpoint answers 404, which is what a deployment
 * with no `githubOrgLogin` would never even ask for.
 */
function makeOauthFetch(membership?: { status: number; body?: unknown }): typeof fetch {
  return (async (url: string) => {
    const u = String(url);
    if (u.includes("access_token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "gho_test" }) };
    }
    if (u.includes("memberships")) {
      const status = membership?.status ?? 404;
      return { ok: status >= 200 && status < 300, status, json: async () => membership?.body ?? {} };
    }
    return { ok: true, status: 200, json: async () => ({ id: 4242, login: "octocat" }) };
  }) as unknown as typeof fetch;
}

const oauthFetch = makeOauthFetch();

const OAUTH = { clientId: "cid", clientSecret: "sec", redirectUri: "https://app/cb" };
const SECRET = "sess-secret";

async function listen(opts: Parameters<typeof createServer>[0] = {}) {
  const { server } = await createServer(opts);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

/**
 * Complete the OAuth callback against `b` and return the issued session.
 *
 * Every caller here expects the sign-in itself to succeed, so a non-200 is surfaced as a
 * failed sign-in rather than leaking through as an absent `role`/`token` further down.
 */
async function signIn(b: string, body: Record<string, unknown> = { code: "thecode" }) {
  const res = await fetch(`${b}/v1/auth/github/callback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, any>;
  expect(res.status, `sign-in failed: ${JSON.stringify(json)}`).toBe(200);
  return { status: res.status, json };
}

function whoAmI(b: string, token: string) {
  return fetch(`${b}/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
}

/** Replace one character with a definitely-different one, keeping the base64url alphabet. */
function flip(s: string, index = 0): string {
  const c = s[index]!;
  return s.slice(0, index) + (c === "A" ? "B" : "A") + s.slice(index + 1);
}

let base: string;
let close: () => void;

beforeAll(async () => {
  // `allowedLogins` is now required for any sign-in to succeed: OAuth alone admits every GitHub
  // account in existence, so a deployment must name who may in. `octocat` is the login the fake
  // OAuth fetch returns.
  ({ base, close } = await listen({
    oauthConfig: OAUTH,
    sessionSecret: SECRET,
    oauthFetch,
    allowedLogins: [{ login: "octocat" }],
  }));
});
afterAll(() => close());

describe("GitHub OAuth sign-in + sessions (FR-027/T076)", () => {
  it("returns an authorize URL carrying the client id, the state, and the read:org scope", async () => {
    const res = await fetch(`${base}/v1/auth/github/login?state=xyz`);
    const json = (await res.json()) as any;
    const params = new URL(json.url).searchParams;
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("state")).toBe("xyz");
    // read:org is what makes the role hierarchy real — without it the membership lookup in
    // authCallback cannot succeed and every user falls back to the default role.
    const scopes = (params.get("scope") ?? "").split(/\s+/);
    expect(scopes).toContain("read:user");
    expect(scopes).toContain("read:org");
  });

  it("refuses to begin a sign-in with no state (CSRF parameter is mandatory)", async () => {
    const res = await fetch(`${base}/v1/auth/github/login`);
    expect(res.status).not.toBe(200);
    expect(String(((await res.json()) as any).error)).toMatch(/state/i);
  });

  it("exchanges a code for a session token, and /auth/me verifies it", async () => {
    const cb = await signIn(base);
    expect(cb.json.user.login).toBe("octocat");
    expect(cb.json.token).toBeTruthy();

    const me = await whoAmI(base, cb.json.token);
    expect(me.status).toBe(200);
    const meJson = (await me.json()) as any;
    expect(meJson.login).toBe("octocat");
    // `viewer`, not `member`: with no GitHub org configured to check membership against, the
    // deployment cannot establish that this person may write, and that resolves to read-only.
    expect(meJson.role).toBe("viewer");
  });

  it("rejects /auth/me without a valid session (401)", async () => {
    expect((await fetch(`${base}/v1/auth/me`)).status).toBe(401);
    expect((await fetch(`${base}/v1/auth/me`, { headers: { authorization: "Bearer garbage" } })).status).toBe(401);
  });

  // Security regression: the token is the only thing standing between a caller and an org's
  // data, so a payload edited by its bearer must not verify.
  it("rejects a token whose payload was edited", async () => {
    const token = (await signIn(base)).json.token as string;
    const dot = token.indexOf(".");
    const tampered = `${flip(token.slice(0, dot))}.${token.slice(dot + 1)}`;
    expect(tampered).not.toBe(token);
    expect((await whoAmI(base, tampered)).status).toBe(401);
  });

  // Security regression: nor may a caller keep a payload and forge a signature over it.
  it("rejects a token whose signature was edited", async () => {
    const token = (await signIn(base)).json.token as string;
    const dot = token.indexOf(".");
    const tampered = `${token.slice(0, dot)}.${flip(token.slice(dot + 1))}`;
    expect(tampered).not.toBe(token);
    expect((await whoAmI(base, tampered)).status).toBe(401);
  });

  // Security regression: expiry is enforced on every request, not only at issue time — a
  // session that has run out is indistinguishable from no session at all.
  it("rejects an expired session even though it is correctly signed", async () => {
    const expired = createSession({ userId: "u1", login: "octocat", orgId: "demo", role: "admin" }, SECRET, -10);
    expect((await whoAmI(base, expired)).status).toBe(401);
  });

  // Security regression: the secret is the only trust anchor, so a token minted elsewhere
  // must not be honoured here.
  it("rejects a token signed with a different secret", async () => {
    const foreign = createSession(
      { userId: "u1", login: "octocat", orgId: "demo", role: "admin" },
      "some-other-secret",
    );
    expect((await whoAmI(base, foreign)).status).toBe(401);
  });

  /*
   * Security regression, and the important one in this file. `authCallback` used to read
   * `orgId` from the POST body: anyone who could complete OAuth against this deployment could
   * name any org in the request and be handed a valid session for it. The org is server
   * configuration now, so a body that names one is simply ignored.
   */
  it("ignores a caller-supplied orgId on the OAuth callback", async () => {
    const cb = await signIn(base, { code: "x", orgId: "other-org" });
    expect(cb.json.orgId).toBe("demo");
    expect(cb.json.orgId).not.toBe("other-org");

    // And the *token* carries the same org, so the claim cannot be smuggled past /auth/me either.
    const me = (await (await whoAmI(base, cb.json.token)).json()) as Session;
    expect(me.orgId).toBe("demo");
  });

  it("respects a configured sessionOrgId rather than the demo default", async () => {
    const srv = await listen({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      oauthFetch,
      sessionOrgId: "acme-inc",
      allowedLogins: [{ login: "octocat" }],
    });
    try {
      const cb = await signIn(srv.base, { code: "x", orgId: "other-org" });
      expect(cb.json.orgId).toBe("acme-inc");
    } finally {
      srv.close();
    }
  });

  it("reports the sign-in doors this deployment actually has", async () => {
    const cfg = (await (await fetch(`${base}/v1/auth/config`)).json()) as any;
    expect(cfg.github).toBe(true);
    expect(cfg.devAuth).toBe(false);
  });
});

/**
 * Admission, and the role that follows from it.
 *
 * These used to assert that a non-member signs in as `viewer`. That WAS the behaviour and it
 * was the bug: a GitHub OAuth app completes the flow for any account on the internet, and since
 * the API requires a session to read, a `viewer` session let a stranger read every finding,
 * scan and repository in the org. Membership is admission now — a non-member gets no session at
 * all — so each of those cases asserts a refusal instead.
 */
describe("admission at sign-in", () => {
  /** Attempt a sign-in without asserting it succeeds. */
  async function attempt(b: string) {
    const res = await fetch(`${b}/v1/auth/github/callback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "thecode" }),
    });
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  }

  it("refuses everyone when the deployment names no org and no allow-list", async () => {
    const srv = await listen({ oauthConfig: OAUTH, sessionSecret: SECRET, oauthFetch });
    try {
      const res = await attempt(srv.base);
      expect(res.status).toBe(403);
      expect(res.json.token).toBeUndefined();
      // The message has to name the fix; this is the state a fresh deployment is in.
      expect(String(res.json.error)).toMatch(/GATEPASS_GITHUB_ORG|GATEPASS_ALLOWED_LOGINS/);
    } finally {
      srv.close();
    }
  });

  it("admits an allow-listed login at viewer when the entry names no role", async () => {
    expect((await signIn(base)).json.role).toBe("viewer");
  });

  it("honours a role named on the allow-list entry", async () => {
    const srv = await listen({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      oauthFetch,
      allowedLogins: [{ login: "octocat", role: "admin" }],
    });
    try {
      const cb = await signIn(srv.base);
      expect(cb.json.role).toBe("admin");
      const me = (await (await whoAmI(srv.base, cb.json.token)).json()) as Session;
      expect(me.role).toBe("admin");
    } finally {
      srv.close();
    }
  });

  it("refuses a login that is not on the allow-list, and says that rather than blaming config", async () => {
    const srv = await listen({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      oauthFetch,
      allowedLogins: [{ login: "someone-else" }],
    });
    try {
      const res = await attempt(srv.base);
      expect(res.status).toBe(403);
      // A configured-but-not-matching allow-list must not report itself as unconfigured: that
      // would send an operator to re-fix settings that are already correct, when the actual
      // fix is adding one login to them.
      expect(String(res.json.error)).toContain("octocat");
      expect(String(res.json.error)).not.toMatch(/GATEPASS_ALLOWED_LOGINS/);
    } finally {
      srv.close();
    }
  });

  it("matches an allow-listed login case-insensitively, as GitHub logins are", async () => {
    const srv = await listen({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      oauthFetch,
      allowedLogins: [{ login: "OctoCat", role: "member" }],
    });
    try {
      expect((await signIn(srv.base)).json.role).toBe("member");
    } finally {
      srv.close();
    }
  });

  it("derives admin from an active GitHub org membership of role admin", async () => {
    const srv = await listen({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      githubOrgLogin: "acme",
      oauthFetch: makeOauthFetch({ status: 200, body: { state: "active", role: "admin" } }),
    });
    try {
      const cb = await signIn(srv.base);
      expect(cb.json.role).toBe("admin");
      const me = (await (await whoAmI(srv.base, cb.json.token)).json()) as Session;
      expect(me.role).toBe("admin");
    } finally {
      srv.close();
    }
  });

  it("derives member from an active GitHub org membership of role member", async () => {
    const srv = await listen({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      githubOrgLogin: "acme",
      oauthFetch: makeOauthFetch({ status: 200, body: { state: "active", role: "member" } }),
    });
    try {
      expect((await signIn(srv.base)).json.role).toBe("member");
    } finally {
      srv.close();
    }
  });

  it("refuses a non-member outright, and a generous defaultRole does not rescue them", async () => {
    const srv = await listen({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      githubOrgLogin: "acme",
      defaultRole: "admin",
      oauthFetch: makeOauthFetch({ status: 404 }),
    });
    try {
      const res = await attempt(srv.base);
      expect(res.status).toBe(403);
      expect(res.json.token).toBeUndefined();
      expect(String(res.json.error)).toContain("acme");
    } finally {
      srv.close();
    }
  });

  it("refuses when the membership call fails, so an outage is never a way in", async () => {
    const srv = await listen({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      githubOrgLogin: "acme",
      oauthFetch: makeOauthFetch({ status: 403 }), // e.g. the token lacks read:org
    });
    try {
      expect((await attempt(srv.base)).status).toBe(403);
    } finally {
      srv.close();
    }
  });

  it("treats a pending invitation as not yet a member", async () => {
    const srv = await listen({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      githubOrgLogin: "acme",
      oauthFetch: makeOauthFetch({ status: 200, body: { state: "pending", role: "admin" } }),
    });
    try {
      expect((await attempt(srv.base)).status).toBe(403);
    } finally {
      srv.close();
    }
  });

  it("lets the allow-list admit someone outside the org, without widening the org rule", async () => {
    const srv = await listen({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      githubOrgLogin: "acme",
      allowedLogins: [{ login: "octocat", role: "member" }],
      oauthFetch: makeOauthFetch({ status: 404 }), // not an org member
    });
    try {
      expect((await signIn(srv.base)).json.role).toBe("member");
    } finally {
      srv.close();
    }
  });
});

describe("parseAllowedLogins", () => {
  it("reads bare logins and login:role pairs", () => {
    expect(parseAllowedLogins("octocat,hubot:admin, spaced :viewer")).toEqual([
      { login: "octocat" },
      { login: "hubot", role: "admin" },
      { login: "spaced", role: "viewer" },
    ]);
  });

  it("is empty for absent or blank configuration, so nobody is admitted by accident", () => {
    expect(parseAllowedLogins(undefined)).toEqual([]);
    expect(parseAllowedLogins("   ")).toEqual([]);
  });

  it("drops an entry naming a role that does not exist rather than downgrading it", () => {
    // `octocat:admn` must stop that person signing in and be noticed — silently granting them
    // read-only would look like it worked.
    expect(parseAllowedLogins("octocat:admn,hubot:admin")).toEqual([{ login: "hubot", role: "admin" }]);
  });
});

describe("development sign-in guard", () => {
  it("403s POST /v1/auth/dev-session on a deployment that did not opt in", async () => {
    const srv = await listen({ oauthConfig: OAUTH, sessionSecret: SECRET, oauthFetch });
    try {
      const res = await fetch(`${srv.base}/v1/auth/dev-session`, { method: "POST" });
      expect(res.status).toBe(403);
    } finally {
      srv.close();
    }
  });

  it("issues a real signed session with no SESSION_SECRET configured", async () => {
    const srv = await listen({ devAuth: true, seedBenchmark: false });
    try {
      const res = await fetch(`${srv.base}/v1/auth/dev-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: "tester" }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.development).toBe(true);
      expect(json.role).toBe("admin");

      // The per-process secret is real: the token verifies through the same code path as OAuth.
      const me = await whoAmI(srv.base, json.token);
      expect(me.status).toBe(200);
      const session = (await me.json()) as Session;
      expect(session.login).toBe("tester");
      expect(session.role).toBe("admin");

      const cfg = (await (await fetch(`${srv.base}/v1/auth/config`)).json()) as any;
      expect(cfg.devAuth).toBe(true);
      expect(cfg.github).toBe(false);
    } finally {
      srv.close();
    }
  });

  /*
   * Security regression: `devAuth: true` is an opt-in, never an override. A production
   * deployment that somehow passes it must still refuse — there must be no argument any
   * caller can supply that opens an unauthenticated door to an admin session in production.
   */
  it("refuses the dev sign-in in production even when devAuth is passed", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    let stop: (() => void) | undefined;
    try {
      const srv = await listen({ devAuth: true, seedBenchmark: false });
      stop = srv.close;
      const res = await fetch(`${srv.base}/v1/auth/dev-session`, { method: "POST" });
      expect(res.status).toBe(403);

      // …and the login page is not told to offer a button that cannot work.
      const cfg = (await (await fetch(`${srv.base}/v1/auth/config`)).json()) as any;
      expect(cfg.devAuth).toBe(false);
    } finally {
      stop?.();
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("devAuthEnabled requires an explicit opt-in AND a non-production NODE_ENV", () => {
    expect(devAuthEnabled({})).toBe(false);
    expect(devAuthEnabled({ GATEPASS_DEV_AUTH: "1" })).toBe(true);
    expect(devAuthEnabled({ GATEPASS_DEV_AUTH: "1", NODE_ENV: "production" })).toBe(false);
    expect(devAuthEnabled({ GATEPASS_DEV_AUTH: "0" })).toBe(false);
    expect(devAuthEnabled({ GATEPASS_DEV_AUTH: "true" })).toBe(true);
  });
});

describe("resolveOrgId", () => {
  const session = (orgId: string, role: Role = "member"): Session => ({
    userId: "u1",
    login: "octocat",
    orgId,
    role,
    jti: `jti-${orgId}`,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const withSession = (orgId: string): RequestAuth => ({ session: session(orgId), enabled: true });
  const anonymous: RequestAuth = { session: null, enabled: true };

  it("lets a session's org outrank both the header and the path", () => {
    const p = ["v1", "orgs", "path-org", "repos"];
    expect(resolveOrgId(withSession("session-org"), { "x-org-id": "header-org" }, p)).toBe("session-org");
    expect(resolveOrgId(withSession("session-org"), {}, p)).toBe("session-org");
  });

  it("prefers the path segment over the caller-supplied header when there is no session", () => {
    const p = ["v1", "orgs", "path-org", "repos"];
    expect(resolveOrgId(anonymous, { "x-org-id": "header-org" }, p)).toBe("path-org");
  });

  it("falls back to the header only when nothing else names an org", () => {
    expect(resolveOrgId(anonymous, { "x-org-id": "header-org" }, ["v1", "scans", "abc"])).toBe("header-org");
    expect(resolveOrgId(anonymous, {}, ["v1", "scans", "abc"])).toBe("unknown");
  });

  /*
   * The rate limiter runs before the runner route validates its bearer token, so whatever it
   * buckets on is chosen by an unauthenticated caller. It used to bucket on `?orgId=`, which
   * means varying one query parameter bought a fresh quota per request.
   */
  it("buckets a runner by its token's org, never by the query string it supplied", () => {
    const runner = ["v1", "runner", "results"];
    expect(resolveOrgId(anonymous, {}, runner, "org-from-token")).toBe("org-from-token");
    // No recognised token: one shared bucket, so flooding costs the flooder their own quota.
    expect(resolveOrgId(anonymous, {}, runner)).toBe("unauthenticated-runner");
    // And a caller-supplied header cannot displace it either.
    expect(resolveOrgId(anonymous, { "x-org-id": "attacker-picked" }, runner)).toBe("unauthenticated-runner");
  });
});

describe("requiredRole", () => {
  const p = (...rest: string[]) => ["v1", "orgs", "demo", ...rest];

  it("asks nothing of a read", () => {
    expect(requiredRole("GET", p("repos"))).toBeUndefined();
    expect(requiredRole("GET", p("settings"))).toBeUndefined();
  });

  it("requires admin for policy, inventory removal, and evidence export", () => {
    expect(requiredRole("PATCH", p("settings"))).toBe("admin");
    expect(requiredRole("PATCH", p("repos", "x"))).toBe("admin");
    expect(requiredRole("DELETE", p("repos", "x"))).toBe("admin");
    expect(requiredRole("POST", p("evidence", "export"))).toBe("admin");
  });

  it("requires only member for ordinary work", () => {
    expect(requiredRole("POST", p("repos"))).toBe("member");
    expect(requiredRole("POST", p("scans"))).toBe("member");
  });

  it("defaults an unrecognised write to member rather than to open", () => {
    expect(requiredRole("POST", p("something-added-later"))).toBe("member");
  });
});

describe("RBAC over a live session", () => {
  let srv: { base: string; close: () => void };
  const token = (orgId: string, role: Role) => createSession({ userId: "u1", login: "octocat", orgId, role }, SECRET);
  const authed = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    srv = await listen({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      oauthFetch,
      seedBenchmark: false,
      allowedLogins: [{ login: "octocat", role: "admin" }],
    });
  });
  afterAll(() => srv.close());

  it("lets a viewer read the repository inventory", async () => {
    const res = await fetch(`${srv.base}/v1/orgs/demo/repos`, { headers: authed(token("demo", "viewer")) });
    expect(res.status).toBe(200);
  });

  // Security regression: the role hierarchy used to be inert (everyone signed in as `member`),
  // so a read-only user could connect repositories.
  it("refuses a viewer the write on the same route", async () => {
    const res = await fetch(`${srv.base}/v1/orgs/demo/repos`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authed(token("demo", "viewer")) },
      body: JSON.stringify({ repo: "acme/viewer-should-not" }),
    });
    expect(res.status).toBe(403);

    // Nothing was written. The read-back carries the viewer's session: reads need one wherever
    // sessions exist, so an anonymous fetch here would assert against a 401 body, not a list.
    const list = (await (
      await fetch(`${srv.base}/v1/orgs/demo/repos`, { headers: authed(token("demo", "viewer")) })
    ).json()) as { name: string }[];
    expect(list.map((r) => r.name)).not.toContain("acme/viewer-should-not");
  });

  it("lets an admin through the same write", async () => {
    const res = await fetch(`${srv.base}/v1/orgs/demo/repos`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authed(token("demo", "admin")) },
      body: JSON.stringify({ repo: "acme/admin-may" }),
    });
    expect(res.status).toBe(201);
  });

  /*
   * Security regression: a session must not be able to reach another tenant, and — just as
   * importantly — must not be silently answered about its own org instead. A dashboard that
   * quietly returned org A's repositories under a URL naming org B would be worse than an error.
   */
  it("refuses a session for one org access to another (403, not a redirect)", async () => {
    const res = await fetch(`${srv.base}/v1/orgs/free-org/repos`, { headers: authed(token("demo", "admin")) });
    expect(res.status).toBe(403);
    expect(String(((await res.json()) as any).error)).toContain("free-org");
  });

  /*
   * Reads, not just writes.
   *
   * Writes were refused anonymously from the start, but every org-scoped GET answered anyone —
   * so gating `/dashboard` in the web middleware bought nothing: the same findings, scan history
   * and repository inventory were one unauthenticated curl away, and org ids are short enough to
   * guess. `GET /orgs/:org/scans` is the worst of them, because it hands out the scan ids that
   * unlock findings and SARIF on the scan-addressed routes.
   */
  it("refuses an anonymous read of every org-scoped route", async () => {
    for (const path of ["/v1/orgs/demo", "/v1/orgs/demo/scans", "/v1/orgs/demo/repos"]) {
      const res = await fetch(`${srv.base}${path}`);
      expect(res.status, `${path} must not answer an anonymous caller`).toBe(401);
    }
  });
});

describe("deployments without sessions are unchanged", () => {
  let srv: { base: string; close: () => void };
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "gp-nosess-"));
    writeFileSync(join(dir, "index.js"), "export const ok = true;\n");
    // No sessionSecret and no devAuth: this deployment cannot issue or check a session at all.
    srv = await listen({ seedBenchmark: false });
  });
  afterAll(() => srv.close());

  it("reports no sign-in doors", async () => {
    const cfg = (await (await fetch(`${srv.base}/v1/auth/config`)).json()) as any;
    expect(cfg.github).toBe(false);
    expect(cfg.devAuth).toBe(false);
  });

  it("still allows an anonymous org-scoped write (the CLI/curl workflow)", async () => {
    const res = await fetch(`${srv.base}/v1/orgs/demo/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).scanId).toBeTruthy();
  });

  it("still allows an anonymous admin-level write", async () => {
    const connect = await fetch(`${srv.base}/v1/orgs/demo/repos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "acme/anon" }),
    });
    expect(connect.status).toBe(201);

    const patch = await fetch(`${srv.base}/v1/orgs/demo/repos/${encodeURIComponent("acme/anon")}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gate_mode: "block_verified" }),
    });
    expect(patch.status).toBe(200);
  });

  it("still allows an anonymous read", async () => {
    expect((await fetch(`${srv.base}/v1/orgs/demo/repos`)).status).toBe(200);
  });
});

/*
 * `/v1/scans/:id/...` names a scan, not a tenant, so `authorizeOrg` — which keys off an `orgs`
 * path segment — never fired for it. A session for org A could read org B's findings, SARIF and
 * gate decision by scan id. Scan ids are UUIDs and so not enumerable, but "unguessable" is not
 * an access control: a scan id travels in links, logs and PR comments.
 */
describe("scan-addressed routes are tenant-scoped", () => {
  let base: string;
  let close: () => void;
  let demoScanId: string;
  let dir: string;

  const token = (orgId: string, role: Role) => createSession({ userId: "u1", login: "octocat", orgId, role }, SECRET);
  const as = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

  beforeAll(async () => {
    const { server } = await createServer({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      oauthFetch,
      seedBenchmark: false,
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();

    dir = mkdtempSync(join(tmpdir(), "gatepass-tenant-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "t", dependencies: { next: "15.0.0" } }));
    const created = await fetch(`${base}/v1/orgs/demo/scans`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token("demo", "admin")}` },
      body: JSON.stringify({ path: dir }),
    });
    demoScanId = ((await created.json()) as { scanId: string }).scanId;
  });
  afterAll(() => close());

  /*
   * The tenant check below only fires once a session exists, so without this the scan id was
   * itself the credential — and a scan id travels in links, logs and PR comments.
   */
  it("refuses an anonymous read, so a scan id alone is not a credential", async () => {
    for (const path of [`/v1/scans/${demoScanId}/findings`, `/v1/scans/${demoScanId}/findings.sarif`]) {
      expect((await fetch(`${base}${path}`)).status, `${path} must not answer an anonymous caller`).toBe(401);
    }
  });

  it("lets the owning org read its own scan", async () => {
    expect((await fetch(`${base}/v1/scans/${demoScanId}/findings`, as(token("demo", "viewer")))).status).toBe(200);
  });

  it("refuses another org's session on findings, SARIF and the gate", async () => {
    const other = token("free-org", "admin");
    expect((await fetch(`${base}/v1/scans/${demoScanId}/findings`, as(other))).status).toBe(403);
    expect((await fetch(`${base}/v1/scans/${demoScanId}/findings.sarif`, as(other))).status).toBe(403);
    const gate = await fetch(`${base}/v1/scans/${demoScanId}/gate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${other}` },
      body: JSON.stringify({ mode: "off", failureMode: "fail_open" }),
    });
    expect(gate.status).toBe(403);
  });

  it("treats the gate as a write, so a viewer of the owning org is refused too", async () => {
    const gate = await fetch(`${base}/v1/scans/${demoScanId}/gate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token("demo", "viewer")}` },
      body: JSON.stringify({ mode: "off", failureMode: "fail_open" }),
    });
    expect(gate.status).toBe(403);
  });
});

describe("GET /v1/auth/github/login answers caller and configuration errors as such", () => {
  it("400 when state is missing, rather than 500", async () => {
    const { server } = await createServer({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      oauthFetch,
      seedBenchmark: false,
    });
    await new Promise<void>((r) => server.listen(0, r));
    const b = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      // A missing CSRF token is the caller's mistake; a 500 would page on-call for it.
      expect((await fetch(`${b}/v1/auth/github/login`)).status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("501 when the deployment has no OAuth credentials, rather than 500", async () => {
    const { server } = await createServer({ seedBenchmark: false });
    await new Promise<void>((r) => server.listen(0, r));
    const b = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${b}/v1/auth/github/login?state=xyz`);
      expect(res.status).toBe(501);
      // The message stays the one apps/web/src/lib/errors.ts pattern-matches on.
      expect(((await res.json()) as { error: string }).error).toMatch(/OAuth not configured/);
    } finally {
      server.close();
    }
  });
});

/**
 * Revocation.
 *
 * Sessions are stateless signed tokens, so before this the only thing that ended one was its own
 * expiry: signing out cleared the browser's cookie and left the token itself working for the
 * rest of its seven days. A copy taken off the wire, or left on a shared machine, could not be
 * withdrawn by anybody. These pin the property that fixes it.
 */
describe("sessions can be withdrawn, not merely expired", () => {
  let srv: { base: string; close: () => void };
  const authed = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

  beforeAll(async () => {
    srv = await listen({
      oauthConfig: OAUTH,
      sessionSecret: SECRET,
      oauthFetch,
      seedBenchmark: false,
      allowedLogins: [{ login: "octocat", role: "admin" }],
    });
  });
  afterAll(() => srv.close());

  async function freshToken(): Promise<string> {
    return (await signIn(srv.base)).json.token as string;
  }

  it("issues every token with a distinct id", async () => {
    const [a, b] = [await freshToken(), await freshToken()];
    const jti = (t: string) => JSON.parse(Buffer.from(t.split(".")[0]!, "base64url").toString()).jti;
    expect(jti(a)).toBeTruthy();
    expect(jti(a)).not.toBe(jti(b));
  });

  it("stops accepting a token once it is signed out", async () => {
    const token = await freshToken();
    expect((await fetch(`${srv.base}/v1/auth/me`, authed(token))).status).toBe(200);

    const out = await fetch(`${srv.base}/v1/auth/signout`, { method: "POST", ...authed(token) });
    expect(out.status).toBe(200);
    expect(((await out.json()) as { revoked: boolean }).revoked).toBe(true);

    expect((await fetch(`${srv.base}/v1/auth/me`, authed(token))).status).toBe(401);
  });

  it("refuses a revoked token on data routes too, not only /auth/me", async () => {
    const token = await freshToken();
    expect((await fetch(`${srv.base}/v1/orgs/demo/repos`, authed(token))).status).toBe(200);
    await fetch(`${srv.base}/v1/auth/signout`, { method: "POST", ...authed(token) });
    // 401, because a withdrawn token is no token — not 403, which would mean "you, but not here".
    expect((await fetch(`${srv.base}/v1/orgs/demo/repos`, authed(token))).status).toBe(401);
  });

  it("revokes only the token presented, leaving the user's other sessions alone", async () => {
    const [laptop, phone] = [await freshToken(), await freshToken()];
    await fetch(`${srv.base}/v1/auth/signout`, { method: "POST", ...authed(laptop) });
    expect((await fetch(`${srv.base}/v1/auth/me`, authed(laptop))).status).toBe(401);
    expect((await fetch(`${srv.base}/v1/auth/me`, authed(phone))).status).toBe(200);
  });

  it("treats a second sign-out as success rather than an error", async () => {
    const token = await freshToken();
    await fetch(`${srv.base}/v1/auth/signout`, { method: "POST", ...authed(token) });
    const again = await fetch(`${srv.base}/v1/auth/signout`, { method: "POST", ...authed(token) });
    expect(again.status).toBe(200);
  });

  it("refuses a correctly-signed token that carries no id, since it could never be revoked", async () => {
    // Exactly what a token issued before revocation existed looks like.
    const legacy = createSession({ userId: "u1", login: "octocat", orgId: "demo", role: "admin", jti: "" }, SECRET);
    expect((await fetch(`${srv.base}/v1/auth/me`, authed(legacy))).status).toBe(401);
  });
});
