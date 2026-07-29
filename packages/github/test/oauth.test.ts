import { describe, it, expect } from "vitest";
import {
  exchangeCodeForUser,
  authorizeUrl,
  fetchOrgMembership,
  DEFAULT_OAUTH_SCOPE,
  OAuthError,
} from "../src/index.js";

const config = { clientId: "cid", clientSecret: "secret", redirectUri: "https://app/cb" };

function fakeFetch(token: string | null, user: unknown) {
  return (async (url: string) => {
    if (String(url).includes("access_token")) {
      return { ok: true, status: 200, json: async () => (token ? { access_token: token } : { error: "bad_code" }) };
    }
    return { ok: true, status: 200, json: async () => user };
  }) as unknown as typeof fetch;
}

/** A fetch that answers the membership endpoint with a fixed status/body and records the URL. */
function membershipFetch(status: number, body: unknown) {
  const calls: string[] = [];
  const impl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      headers: init?.headers,
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("GitHub OAuth (FR-027/T076)", () => {
  it("builds an authorize URL with client id, scope, and state", () => {
    const url = authorizeUrl(config, "xyz");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("state=xyz");
    expect(url).toContain("login/oauth/authorize");
  });

  it("requests read:org by default so a role can be derived from real org membership", () => {
    const scopes = (new URL(authorizeUrl(config, "xyz")).searchParams.get("scope") ?? "").split(/\s+/);
    expect(scopes).toContain("read:user");
    expect(scopes).toContain("read:org");
    // …and nothing that would grant access to code — repositories are read through the App.
    expect(scopes).not.toContain("repo");
    expect(DEFAULT_OAUTH_SCOPE.split(/\s+/)).toEqual(scopes);
  });

  it("lets an explicit scope argument override the default", () => {
    const url = authorizeUrl(config, "xyz", "read:user");
    expect(new URL(url).searchParams.get("scope")).toBe("read:user");
  });

  it("carries the redirect URI only when one is configured", () => {
    expect(new URL(authorizeUrl(config, "s")).searchParams.get("redirect_uri")).toBe("https://app/cb");
    const bare = authorizeUrl({ clientId: "cid", clientSecret: "s" }, "s");
    expect(new URL(bare).searchParams.has("redirect_uri")).toBe(false);
  });

  it("exchanges a code for the authenticated user", async () => {
    const user = await exchangeCodeForUser("thecode", config, fakeFetch("tok123", { id: 42, login: "octocat" }));
    expect(user).toEqual({ githubUserId: 42, login: "octocat", accessToken: "tok123" });
  });

  it("throws when the code is invalid (no access token)", async () => {
    await expect(exchangeCodeForUser("bad", config, fakeFetch(null, {}))).rejects.toThrow(OAuthError);
  });

  it("throws on an incomplete user profile", async () => {
    await expect(exchangeCodeForUser("c", config, fakeFetch("tok", { id: 0 }))).rejects.toThrow(OAuthError);
  });
});

describe("fetchOrgMembership", () => {
  it("returns the state and role GitHub reported", async () => {
    const { impl, calls } = membershipFetch(200, { state: "active", role: "admin" });
    await expect(fetchOrgMembership("acme", "gho_x", impl)).resolves.toEqual({ state: "active", role: "admin" });
    expect(calls[0]).toBe("https://api.github.com/user/memberships/orgs/acme");
  });

  it("URL-encodes the organization login", async () => {
    const { impl, calls } = membershipFetch(200, { state: "active", role: "member" });
    await fetchOrgMembership("a c/me", "gho_x", impl);
    expect(calls[0]).toBe("https://api.github.com/user/memberships/orgs/a%20c%2Fme");
  });

  /*
   * 404 (not a member) and 403 (token lacks read:org) are answers, not failures, and both have
   * to resolve to the lowest privilege. Throwing here would let a GitHub outage or a narrowed
   * scope surface as a 500 instead of a read-only session.
   */
  it("resolves to undefined rather than throwing when the user is not a member (404)", async () => {
    const { impl } = membershipFetch(404, { message: "Not Found" });
    await expect(fetchOrgMembership("acme", "gho_x", impl)).resolves.toBeUndefined();
  });

  it("resolves to undefined rather than throwing when the token lacks the scope (403)", async () => {
    const { impl } = membershipFetch(403, { message: "Forbidden" });
    await expect(fetchOrgMembership("acme", "gho_x", impl)).resolves.toBeUndefined();
  });

  it("resolves to undefined when GitHub answers 200 with no role", async () => {
    const { impl } = membershipFetch(200, { state: "active" });
    await expect(fetchOrgMembership("acme", "gho_x", impl)).resolves.toBeUndefined();
  });

  it("assumes an active membership when GitHub omits the state", async () => {
    const { impl } = membershipFetch(200, { role: "member" });
    await expect(fetchOrgMembership("acme", "gho_x", impl)).resolves.toEqual({ state: "active", role: "member" });
  });

  it("reports a pending invitation as pending rather than swallowing it", async () => {
    const { impl } = membershipFetch(200, { state: "pending", role: "admin" });
    await expect(fetchOrgMembership("acme", "gho_x", impl)).resolves.toEqual({ state: "pending", role: "admin" });
  });
});
