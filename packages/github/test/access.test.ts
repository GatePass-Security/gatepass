import { describe, it, expect } from "vitest";
import { resolveAccess, orgGrantOf, repoGrantOf, maxPermission, type AccessResolverOptions } from "../src/index.js";

/**
 * Access resolution is the whole access-control model: what these tests assert is not "the
 * parser handles this JSON shape" but "this person can see these repositories and no others".
 *
 * So every case is written as a claim about a person. The GitHub payloads are only the way the
 * claim gets stated.
 */

const USER = { githubUserId: 42, login: "octocat", accessToken: "user-token" };

interface Route {
  /** Substring match against the request URL. First match wins, so order the specific first. */
  match: string;
  status?: number;
  body?: unknown;
  /** Throw instead of answering — a network failure, not an HTTP error. */
  throws?: boolean;
}

/** A fetch that answers from a route table and records what was asked, with what credential. */
function routedFetch(routes: Route[]) {
  const calls: { url: string; token: string }[] = [];
  const impl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    const token = (init?.headers?.authorization ?? "").replace(/^Bearer /, "");
    calls.push({ url: String(url), token });
    const route = routes.find((r) => String(url).includes(r.match));
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    if (route.throws) throw new Error("network down");
    const status = route.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => route.body ?? {} };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function membership(login: string, role: string, state = "active") {
  return { state, role, organization: { login } };
}

function installation(id: number, login: string, type = "Organization") {
  return { id, account: { login, type } };
}

function repo(full_name: string, permissions: Record<string, boolean>) {
  return { full_name, permissions };
}

/** The common GitHub-App shape: memberships, installations, and per-installation repositories. */
function appDeployment(opts: {
  memberships?: unknown[];
  installations?: unknown[];
  repos?: Record<number, unknown[]>;
}): Route[] {
  const routes: Route[] = [
    { match: "/user/memberships/orgs", body: opts.memberships ?? [] },
    { match: "/user/installations?", body: { installations: opts.installations ?? [] } },
  ];
  for (const [id, repositories] of Object.entries(opts.repos ?? {})) {
    routes.unshift({ match: `/user/installations/${id}/repositories`, body: { repositories } });
  }
  return routes;
}

describe("resolving a user's access from GitHub (GitHub App path)", () => {
  it("gives a user exactly the repositories the installation shares with them", async () => {
    const { impl } = routedFetch(
      appDeployment({
        memberships: [membership("acme", "member")],
        installations: [installation(7, "acme")],
        repos: { 7: [repo("acme/api", { push: true, pull: true }), repo("acme/web", { pull: true })] },
      }),
    );

    const grant = await resolveAccess(USER, { fetchImpl: impl });

    expect(grant.orgs.map((o) => o.login)).toEqual(["acme"]);
    expect(grant.orgs[0]!.repos.map((r) => r.name)).toEqual(["acme/api", "acme/web"]);
    // The forty-eight repositories in the org that GitHub did not return are not here, and
    // nothing in Gatepass had to work out that they should not be.
    expect(grant.orgs[0]!.granularity).toBe("installation");
  });

  it("asks GitHub with the user's own token, never a privileged one", async () => {
    const { impl, calls } = routedFetch(
      appDeployment({
        memberships: [membership("acme", "member")],
        installations: [installation(7, "acme")],
        repos: { 7: [repo("acme/api", { push: true })] },
      }),
    );

    await resolveAccess(USER, { fetchImpl: impl, installationToken: "installation-token" });

    // Every call on this path is scoped by GitHub to the signed-in user. If any of them went
    // out with the installation token the answer would be "what the App can see", which is
    // every repository in the org — the exact over-grant this module exists to prevent.
    expect(calls.every((c) => c.token === "user-token")).toBe(true);
  });

  it("makes an org owner an admin and an ordinary member a member", async () => {
    const { impl } = routedFetch(
      appDeployment({
        memberships: [membership("acme", "admin"), membership("beta", "member")],
        installations: [installation(7, "acme"), installation(8, "beta")],
        repos: { 7: [repo("acme/api", { admin: true })], 8: [repo("beta/site", { push: true })] },
      }),
    );

    const grant = await resolveAccess(USER, { fetchImpl: impl });

    expect(orgGrantOf(grant, "acme")!.role).toBe("admin");
    expect(orgGrantOf(grant, "beta")!.role).toBe("member");
  });

  it("caps an outside collaborator at member however much they hold on a repository", async () => {
    const { impl } = routedFetch(
      appDeployment({
        // No membership at all: this person is a collaborator on a repo, not in the org.
        memberships: [],
        installations: [installation(7, "acme")],
        repos: { 7: [repo("acme/api", { admin: true, maintain: true, push: true, pull: true })] },
      }),
    );

    const org = orgGrantOf(await resolveAccess(USER, { fetchImpl: impl }), "acme")!;

    // Repository admin, so they can work on it — but org settings, gate policy and evidence
    // export belong to the organization, and they are not in it.
    expect(org.repos[0]!.permission).toBe("admin");
    expect(org.member).toBe(false);
    expect(org.role).toBe("member");
  });

  it("leaves a read-only outside collaborator at viewer", async () => {
    const { impl } = routedFetch(
      appDeployment({
        memberships: [],
        installations: [installation(7, "acme")],
        repos: { 7: [repo("acme/api", { pull: true })] },
      }),
    );

    expect(orgGrantOf(await resolveAccess(USER, { fetchImpl: impl }), "acme")!.role).toBe("viewer");
  });

  it("treats a personal-account installation as the account owner's own tenant", async () => {
    const { impl } = routedFetch(
      appDeployment({
        memberships: [],
        installations: [installation(9, "octocat", "User")],
        repos: { 9: [repo("octocat/side-project", { admin: true })] },
      }),
    );

    const org = orgGrantOf(await resolveAccess(USER, { fetchImpl: impl }), "octocat")!;
    expect(org.role).toBe("admin");
    expect(org.accountType).toBe("User");
  });

  it("drops an installation that shares no repository with the user", async () => {
    const { impl } = routedFetch(
      appDeployment({
        memberships: [membership("acme", "member")],
        installations: [installation(7, "acme")],
        repos: { 7: [] },
      }),
    );

    // An org whose every page would be empty is not access, and listing it would assert a
    // tenancy we have no evidence for.
    expect((await resolveAccess(USER, { fetchImpl: impl })).orgs).toEqual([]);
  });

  it("gives no access to an org member who reaches no installation", async () => {
    const { impl } = routedFetch(
      appDeployment({
        // A real, active member of an org Gatepass tracks repositories for — but the Gatepass
        // App is not installed anywhere they can reach.
        memberships: [membership("acme", "admin")],
        installations: [],
      }),
    );

    /*
     * The regression this exists for: when the installation endpoint *answers*, its answer is
     * final even when the answer is "nothing". Falling through to the membership path here
     * would hand an org owner every repository Gatepass tracks for that org without a single
     * installation grant behind it — undoing the whole point of resolving access per repo.
     */
    const grant = await resolveAccess(USER, {
      fetchImpl: impl,
      knownRepos: async () => ["acme/api", "acme/web", "acme/secret"],
    });
    expect(grant.orgs).toEqual([]);
  });

  it("denies rather than falling back when the installations endpoint is broken", async () => {
    const { impl } = routedFetch([
      { match: "/user/memberships/orgs", body: [membership("acme", "admin")] },
      { match: "/user/installations", status: 500, body: {} },
    ]);

    // A 500 is not "this credential has no installations" — it is "we do not know". The
    // coarse fallback would answer a question nobody managed to ask.
    const grant = await resolveAccess(USER, { fetchImpl: impl, knownRepos: async () => ["acme/api"] });
    expect(grant.orgs).toEqual([]);
  });

  it("drops an org outside this deployment's allow-list even when GitHub grants it", async () => {
    const { impl } = routedFetch(
      appDeployment({
        memberships: [membership("acme", "admin"), membership("other", "admin")],
        installations: [installation(7, "acme"), installation(8, "other")],
        repos: { 7: [repo("acme/api", { push: true })], 8: [repo("other/thing", { push: true })] },
      }),
    );

    const grant = await resolveAccess(USER, { fetchImpl: impl, orgAllowList: ["acme"] });
    expect(grant.orgs.map((o) => o.login)).toEqual(["acme"]);
  });

  it("preserves maintain rather than flattening it to write", async () => {
    const { impl } = routedFetch(
      appDeployment({
        memberships: [membership("acme", "member")],
        installations: [installation(7, "acme")],
        repos: { 7: [repo("acme/api", { maintain: true, push: true, pull: true })] },
      }),
    );

    const org = orgGrantOf(await resolveAccess(USER, { fetchImpl: impl }), "acme")!;
    expect(repoGrantOf(org, "acme/api")!.permission).toBe("maintain");
  });
});

describe("resolving a user's access from GitHub (OAuth App fallback)", () => {
  const knownRepos = async (org: string) => (org === "acme" ? ["acme/api", "acme/web", "acme/secret"] : []);
  /** Gatepass's own tenant records. On this path they are the only evidence of who is a customer. */
  const knownOrg = async (org: string) => org === "acme";

  /** What a classic OAuth App gets: `/user/installations` is not available to its tokens. */
  function oauthAppRoutes(extra: Route[] = []): Route[] {
    return [
      ...extra,
      { match: "/user/memberships/orgs", body: [membership("acme", "member")] },
      { match: "/user/installations", status: 403, body: { message: "Resource not accessible" } },
    ];
  }

  it("asks GitHub per repository who collaborates, and admits only those", async () => {
    const { impl } = routedFetch(
      oauthAppRoutes([
        { match: "acme/api/collaborators", body: { permission: "write", role_name: "write" } },
        { match: "acme/web/collaborators", body: { permission: "read", role_name: "read" } },
        // GitHub answers 200 with "none" for someone who is not a collaborator. That is an
        // answer meaning no, and reading it as a permission level would hand this user a
        // repository they have no access to whatsoever.
        { match: "acme/secret/collaborators", body: { permission: "none" } },
      ]),
    );

    const org = orgGrantOf(
      await resolveAccess(USER, { fetchImpl: impl, knownRepos, knownOrg, installationToken: "inst" }),
      "acme",
    )!;

    expect(org.repos.map((r) => r.name)).toEqual(["acme/api", "acme/web"]);
    expect(org.granularity).toBe("collaborator");
  });

  it("asks the collaborator endpoint with the installation token, not the user's", async () => {
    const { impl, calls } = routedFetch(oauthAppRoutes([{ match: "/collaborators/", body: { role_name: "write" } }]));

    await resolveAccess(USER, { fetchImpl: impl, knownRepos, knownOrg, installationToken: "inst" });

    // A read-only collaborator asking this endpoint about themselves gets 403, which is
    // indistinguishable from "no access" — so asking as the user would lock out exactly the
    // people the call is meant to describe.
    const collaboratorCalls = calls.filter((c) => c.url.includes("/collaborators/"));
    expect(collaboratorCalls.length).toBeGreaterThan(0);
    expect(collaboratorCalls.every((c) => c.token === "inst")).toBe(true);
  });

  it("says so when it can only establish org membership, rather than passing it off as repo access", async () => {
    const { impl } = routedFetch(oauthAppRoutes());

    const org = orgGrantOf(await resolveAccess(USER, { fetchImpl: impl, knownRepos, knownOrg }), "acme")!;

    expect(org.granularity).toBe("org-membership");
    expect(org.repos.map((r) => r.name)).toEqual(["acme/api", "acme/web", "acme/secret"]);
  });

  it("does not treat an unaccepted invitation as membership", async () => {
    const { impl } = routedFetch([
      { match: "/user/memberships/orgs", body: [membership("acme", "admin", "pending")] },
      { match: "/user/installations", status: 403, body: {} },
    ]);

    expect((await resolveAccess(USER, { fetchImpl: impl, knownRepos, knownOrg })).orgs).toEqual([]);
  });

  it("bounds the number of per-repository checks so a large org cannot hang a sign-in", async () => {
    const many = Array.from({ length: 50 }, (_, i) => `acme/r${i}`);
    const { impl, calls } = routedFetch(oauthAppRoutes([{ match: "/collaborators/", body: { role_name: "write" } }]));

    const opts: AccessResolverOptions = {
      fetchImpl: impl,
      knownRepos: async () => many,
      knownOrg,
      installationToken: "inst",
      maxCollaboratorChecks: 10,
    };
    const org = orgGrantOf(await resolveAccess(USER, opts), "acme")!;

    expect(calls.filter((c) => c.url.includes("/collaborators/")).length).toBe(10);
    expect(org.repos.length).toBe(10);
  });

  it("ignores an org the user belongs to that is not a Gatepass tenant", async () => {
    const { impl } = routedFetch([
      {
        match: "/user/memberships/orgs",
        body: [membership("some-club", "admin"), membership("acme", "member")],
      },
      { match: "/user/installations", status: 403, body: {} },
    ]);

    /*
     * The hazard this closes: GitHub's membership list cannot tell a customer from an unrelated
     * org somebody happens to belong to. Without the `knownOrg` check the first entry becomes
     * their tenant — Gatepass provisions an empty org called `some-club` and drops them into
     * it, instead of the org whose findings they came to read.
     */
    const grant = await resolveAccess(USER, { fetchImpl: impl, knownRepos, knownOrg });
    expect(grant.orgs.map((o) => o.login)).toEqual(["acme"]);
  });

  it("admits nobody on this path when Gatepass cannot say which orgs are tenants", async () => {
    const { impl } = routedFetch(oauthAppRoutes());

    // No `knownOrg` supplied at all. Fail closed: an unanswerable question is not a yes.
    expect((await resolveAccess(USER, { fetchImpl: impl, knownRepos })).orgs).toEqual([]);
  });
});

describe("failure denies", () => {
  it("returns no access when GitHub is unreachable, rather than no restriction", async () => {
    const { impl } = routedFetch([{ match: "https://api.github.com", throws: true }]);

    const grant = await resolveAccess(USER, { fetchImpl: impl, knownRepos: async () => ["acme/api"] });

    // The failure mode that matters: an outage must cost people access they have and must
    // never hand anyone access they do not.
    expect(grant.orgs).toEqual([]);
    expect(grant.login).toBe("octocat");
  });

  it("returns no access when GitHub answers every call with an error", async () => {
    const { impl } = routedFetch([{ match: "https://api.github.com", status: 500, body: {} }]);
    expect((await resolveAccess(USER, { fetchImpl: impl })).orgs).toEqual([]);
  });
});

describe("permission ordering", () => {
  it("ranks admin above maintain above write above triage above read", () => {
    expect(maxPermission("read", "admin")).toBe("admin");
    expect(maxPermission("maintain", "write")).toBe("maintain");
    expect(maxPermission("triage", "read")).toBe("triage");
    expect(maxPermission("write", "write")).toBe("write");
  });
});
