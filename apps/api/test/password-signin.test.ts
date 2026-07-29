import { describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import type { AccessGrant, GitHubUser } from "@gatepass/github";
import { hashPassword, parsePasswordHash, verifyPassword, verifySession } from "@gatepass/shared";
import { createServer } from "../src/server.js";
import { MemoryStore, newRepoRecord } from "../src/store.js";
import { PasswordAttemptLimiter, parseLocalUsers } from "../src/auth.js";

/**
 * The local password door — a sign-in for somebody who should be able to look at a deployment
 * without first authorizing an OAuth app against their personal GitHub account.
 *
 * It is a shared credential by design, which is exactly why the tests below are about the
 * things that go wrong with shared credentials: guessing, enumeration, and access that outlives
 * the reason it was handed out.
 */

const SECRET = "sess-secret";

async function localUsers(password = "correct-horse-battery"): Promise<ReturnType<typeof parseLocalUsers>> {
  return parseLocalUsers(`reviewer:${await hashPassword(password)}:viewer,boss:${await hashPassword(password)}:admin`);
}

async function listen(opts: Parameters<typeof createServer>[0] = {}) {
  const { server } = await createServer({ sessionSecret: SECRET, ...opts });
  await new Promise<void>((r) => server.listen(0, r));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => server.close(),
  };
}

async function signIn(base: string, login: string, password: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/v1/auth/password`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ login, password }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

describe("hashing", () => {
  it("verifies the right password and refuses a wrong one", async () => {
    const stored = await hashPassword("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", stored)).toBe(true);
    expect(await verifyPassword("correct-horse-batterz", stored)).toBe(false);
  });

  it("never stores the password, and never produces the same hash twice", async () => {
    const a = await hashPassword("correct-horse-battery");
    const b = await hashPassword("correct-horse-battery");
    // A per-hash salt: two deployments using the same password do not share a hash, and one
    // cracked hash does not unlock the other.
    expect(a).not.toBe(b);
    expect(a).not.toContain("correct-horse-battery");
  });

  it("refuses a hash whose cost parameters are absurd, rather than trying to honour them", async () => {
    // A malformed environment variable must not turn one sign-in attempt into gigabytes of
    // allocation. An unparseable entry means "no such user", never "let them in".
    expect(parsePasswordHash("scrypt.99999999.8.1.aa.bb")).toBeUndefined();
    expect(parsePasswordHash("scrypt.32768.8.1.nothex.bb")).toBeUndefined();
    expect(parsePasswordHash("plaintext-password")).toBeUndefined();
    expect(await verifyPassword("anything", "plaintext-password")).toBe(false);
  });

  it("drops a configured entry whose hash does not parse", async () => {
    // Otherwise the deployment has a user who can never authenticate but still exists to be
    // probed — and the boot log would report an account that is not really there.
    expect(parseLocalUsers("admin:not-a-hash:admin")).toEqual([]);
    expect(parseLocalUsers(`admin:${await hashPassword("longenoughpassword")}`)).toHaveLength(1);
  });

  it("defaults an entry with no role to viewer", async () => {
    const [user] = parseLocalUsers(`admin:${await hashPassword("longenoughpassword")}`);
    // The obvious use is handing somebody a look at a deployment, and read-only is what that
    // needs. More than that has to be asked for.
    expect(user!.role).toBe("viewer");
  });
});

describe("signing in", () => {
  it("issues a real signed session at the configured role", async () => {
    const srv = await listen({ localUsers: await localUsers() });
    try {
      const { status, json } = await signIn(srv.base, "reviewer", "correct-horse-battery");
      expect(status).toBe(200);
      expect(json.role).toBe("viewer");

      // The same signed token every other door issues — not a special case the guards downstream
      // have to know about.
      const claims = verifySession(json.token, SECRET);
      expect(claims?.login).toBe("reviewer");
      expect(claims?.userId).toBe("local:reviewer");
      expect(claims?.jti).toBeTruthy();
    } finally {
      srv.close();
    }
  });

  it("expires in a day, not the seven a GitHub sign-in gets", async () => {
    const srv = await listen({ localUsers: await localUsers() });
    try {
      const { json } = await signIn(srv.base, "reviewer", "correct-horse-battery");
      const ttl = verifySession(json.token, SECRET)!.exp - Math.floor(Date.now() / 1000);
      // A password account is shared by nature, so the window in which a token lifted off one
      // of those machines stays useful should be the short one.
      expect(ttl).toBeGreaterThan(23 * 3600);
      expect(ttl).toBeLessThanOrEqual(24 * 3600);
    } finally {
      srv.close();
    }
  });

  it("gives the same answer for a wrong password and a user who does not exist", async () => {
    const srv = await listen({ localUsers: await localUsers() });
    try {
      const wrong = await signIn(srv.base, "reviewer", "not-the-password");
      const absent = await signIn(srv.base, "nobody-at-all", "not-the-password");

      /*
       * The difference between "no such account" and "wrong password" is the first thing worth
       * knowing before attacking one, and a login form that distinguishes them is an
       * account-enumeration oracle.
       */
      expect(wrong.status).toBe(401);
      expect(absent.status).toBe(401);
      expect(wrong.json.error).toBe(absent.json.error);
    } finally {
      srv.close();
    }
  });

  it("answers 401 rather than 403, because it does not know who this is", async () => {
    const srv = await listen({ localUsers: await localUsers() });
    try {
      // 403 would be a claim that we recognised them and said no — a hint worth withholding.
      expect((await signIn(srv.base, "reviewer", "wrong")).status).toBe(401);
    } finally {
      srv.close();
    }
  });

  it("takes roughly as long to refuse an unknown login as a known one", async () => {
    const srv = await listen({ localUsers: await localUsers() });
    try {
      const time = async (login: string) => {
        const t = process.hrtime.bigint();
        await signIn(srv.base, login, "not-the-password");
        return Number(process.hrtime.bigint() - t) / 1e6;
      };
      const known = await time("reviewer");
      const unknown = await time("nobody-at-all");

      /*
       * Without the dummy scrypt in `verifyNothing`, an unknown login is refused in
       * microseconds while a known one costs a full hash — which enumerates accounts by
       * stopwatch. The bound is loose because this is a wall-clock measurement on a shared
       * machine; what it catches is the order-of-magnitude gap, which is the one that matters.
       */
      expect(unknown).toBeGreaterThan(known / 5);
    } finally {
      srv.close();
    }
  });

  it("reports itself unconfigured when no local accounts exist", async () => {
    const srv = await listen({});
    try {
      const { status } = await signIn(srv.base, "reviewer", "correct-horse-battery");
      // 501: nothing is broken and nobody is being refused — the door does not exist here.
      expect(status).toBe(501);
    } finally {
      srv.close();
    }
  });

  it("signs in with an account that exists only in the database", async () => {
    const store = new MemoryStore();
    await store.putLocalAccount({
      login: "partner",
      passwordHash: await hashPassword("correct-horse-battery"),
      role: "viewer",
    });
    // No `localUsers` at all: the environment names nobody, and the account is a row.
    const srv = await listen({ store });
    try {
      const { status, json } = await signIn(srv.base, "partner", "correct-horse-battery");
      expect(status).toBe(200);
      expect(json.role).toBe("viewer");
    } finally {
      srv.close();
    }
  });

  it("lets the environment win over a stale row for the same login", async () => {
    const store = new MemoryStore();
    await store.putLocalAccount({
      login: "admin",
      passwordHash: await hashPassword("the-old-password"),
      role: "admin",
    });
    const srv = await listen({
      store,
      localUsers: parseLocalUsers(`admin:${await hashPassword("the-new-password")}:admin`),
    });
    try {
      /*
       * Rotation has to mean what an operator expects: change the variable, restart, the old
       * password stops working. Database-first would let a row nobody remembers writing outrank
       * the value they just edited — and an ambiguous answer to "which password is current" is
       * the worst possible property for a credential.
       */
      expect((await signIn(srv.base, "admin", "the-new-password")).status).toBe(200);
      expect((await signIn(srv.base, "admin", "the-old-password")).status).toBe(401);
    } finally {
      srv.close();
    }
  });

  it("is not offered on a deployment that has not configured it", async () => {
    const srv = await listen({});
    try {
      const res = await fetch(`${srv.base}/v1/auth/config`);
      expect(((await res.json()) as { password?: boolean }).password).toBe(false);
    } finally {
      srv.close();
    }
  });
});

describe("guessing is bounded", () => {
  it("stops accepting attempts after repeated failures, then lets a good one through later", () => {
    const limiter = new PasswordAttemptLimiter(3, 60_000);
    const now = Date.now();

    for (let i = 0; i < 3; i++) {
      expect(limiter.check("reviewer", "1.2.3.4", now).allowed).toBe(true);
      limiter.fail("reviewer", "1.2.3.4", now);
    }
    expect(limiter.check("reviewer", "1.2.3.4", now).allowed).toBe(false);
    // A rate limit, not a lockout: it clears on its own.
    expect(limiter.check("reviewer", "1.2.3.4", now + 61_000).allowed).toBe(true);
  });

  it("counts the login and the address separately", () => {
    const limiter = new PasswordAttemptLimiter(3, 60_000);
    const now = Date.now();

    // One host spraying three different logins: the per-login counters stay low, and only the
    // address counter catches it. Keying on either alone would miss one of the two attacks.
    for (const login of ["a", "b", "c"]) limiter.fail(login, "9.9.9.9", now);
    expect(limiter.check("d", "9.9.9.9", now).allowed).toBe(false);
    expect(limiter.check("a", "5.5.5.5", now).allowed).toBe(true);
  });

  it("clears the count when the password is finally right", () => {
    const limiter = new PasswordAttemptLimiter(3, 60_000);
    const now = Date.now();
    limiter.fail("reviewer", "1.2.3.4", now);
    limiter.fail("reviewer", "1.2.3.4", now);
    limiter.succeed("reviewer", "1.2.3.4");
    // Two typos followed by getting it right must not leave someone one mistake from a lockout.
    for (let i = 0; i < 3; i++) {
      expect(limiter.check("reviewer", "1.2.3.4", now).allowed).toBe(true);
      limiter.fail("reviewer", "1.2.3.4", now);
    }
  });

  it("holds the door over HTTP after enough failures, without a password check", async () => {
    const srv = await listen({ localUsers: await localUsers() });
    try {
      for (let i = 0; i < 5; i++) await signIn(srv.base, "reviewer", "wrong");
      const { status, json } = await signIn(srv.base, "reviewer", "correct-horse-battery");

      // 429 even for the *correct* password: the limiter runs before any scrypt work, which is
      // also what stops a flood turning this route into a CPU exhaustion vector.
      expect(status).toBe(429);
      expect(json.retryAfter).toBeGreaterThan(0);
    } finally {
      srv.close();
    }
  });
});

describe("connecting GitHub from inside the dashboard", () => {
  const GRANT_ORGS = [
    {
      login: "acme",
      installationId: 7,
      accountType: "Organization" as const,
      role: "member" as const,
      member: true,
      repos: [{ name: "acme/api", permission: "write" as const }],
      granularity: "installation" as const,
    },
  ];

  const resolve = async (user: GitHubUser): Promise<AccessGrant> => ({
    githubUserId: user.githubUserId,
    login: user.login,
    orgs: GRANT_ORGS,
    resolvedAt: new Date().toISOString(),
  });

  const oauthFetch = (async (url: string) => {
    if (String(url).includes("access_token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "gho_test" }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: 4242, login: "octocat" }) };
  }) as unknown as typeof fetch;

  it("attaches the GitHub grant to the account already signed in, without swapping identity", async () => {
    const store = new MemoryStore();
    await store.upsertOrg({ id: "demo", planTier: "scale", llmEnabled: true, agentLoopEnabled: true });
    await store.connectRepo(newRepoRecord("acme", "acme/api", { source: "github" }));

    const srv = await listen({
      store,
      localUsers: await localUsers(),
      oauthConfig: { clientId: "cid", clientSecret: "sec" },
      oauthFetch,
      githubAccess: { resolve },
      sessionOrgId: "demo",
    });
    try {
      const { json: signedIn } = await signIn(srv.base, "boss", "correct-horse-battery");
      const token = String(signedIn.token);

      const link = await fetch(`${srv.base}/v1/auth/github/link`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: "thecode" }),
      });
      expect(link.status).toBe(200);
      expect(((await link.json()) as Record<string, any>).orgs).toEqual([{ id: "acme", role: "member", repoCount: 1 }]);

      /*
       * The token they are holding still works, and still identifies them as `boss` in `demo`.
       * Re-issuing a session here would silently swap them into the GitHub identity, which is
       * not what "connect your GitHub" means to the person clicking it.
       */
      const me = await fetch(`${srv.base}/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
      const claims = (await me.json()) as Record<string, any>;
      expect(claims.login).toBe("boss");
      expect(claims.orgId).toBe("demo");
      // …and the org they can now reach shows up, which is the whole point.
      expect(claims.orgs.map((o: { id: string }) => o.id)).toEqual(["acme"]);
    } finally {
      srv.close();
    }
  });

  it("files the grant under the signed-in account, not the GitHub user id", async () => {
    const store = new MemoryStore();
    await store.upsertOrg({ id: "demo", planTier: "scale", llmEnabled: true, agentLoopEnabled: true });

    const srv = await listen({
      store,
      localUsers: await localUsers(),
      oauthConfig: { clientId: "cid", clientSecret: "sec" },
      oauthFetch,
      githubAccess: { resolve },
      sessionOrgId: "demo",
    });
    try {
      const { json } = await signIn(srv.base, "boss", "correct-horse-battery");
      await fetch(`${srv.base}/v1/auth/github/link`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${json.token}` },
        body: JSON.stringify({ code: "thecode" }),
      });

      /*
       * Filed under `local:boss`, which is what the session carries as `userId`. Filed under
       * the GitHub id `4242` instead, the link would appear to succeed and change nothing —
       * `scopeFor` looks the grant up by the session's id and would find none.
       */
      expect(await store.getUserAccess("local:boss")).toBeDefined();
      expect(await store.getUserAccess("4242")).toBeUndefined();
    } finally {
      srv.close();
    }
  });

  it("refuses to link without a session", async () => {
    const srv = await listen({
      localUsers: await localUsers(),
      oauthConfig: { clientId: "cid", clientSecret: "sec" },
      oauthFetch,
      githubAccess: { resolve },
    });
    try {
      const res = await fetch(`${srv.base}/v1/auth/github/link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "thecode" }),
      });
      // The account to link comes from the session. With no session there is no account, and a
      // route that took one from the body would let anyone graft GitHub access onto it.
      expect(res.status).toBe(401);
    } finally {
      srv.close();
    }
  });
});
