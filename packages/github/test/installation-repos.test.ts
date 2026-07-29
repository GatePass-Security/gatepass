import { describe, it, expect } from "vitest";
import {
  listInstallationRepos,
  getRepoMetadata,
  createRepoDirectory,
  RepoDiscoveryError,
  REPO_SLUG,
} from "../src/index.js";

/**
 * Read-only repository discovery.
 *
 * `visibility` is the reason this module exists: the repos list used to print the literal
 * `"private"` for every row without ever asking GitHub. So the mapping tests below separate two
 * questions that look alike and are not:
 *
 *   - an *ambiguous* answer (GitHub said `"internal"`) rounds down to private, because
 *     under-stating exposure is the safe error to make; and
 *   - a *missing* answer (GitHub said nothing) stays missing, because rounding it to private
 *     would invent a fact about exposure out of a gap in a payload.
 */

interface Call {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

/** A fetch stub that replays queued responses and records every call. */
function stubFetch(responses: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  let i = 0;
  const impl = async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    calls.push({ url, method: init?.method, headers: init?.headers });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {} };
  };
  return { impl, calls };
}

function repo(id: number, extra: Record<string, unknown> = {}) {
  return { id, full_name: `acme/r${id}`, private: true, default_branch: "main", ...extra };
}
const page = (n: number) => ({ repositories: Array.from({ length: n }, (_, k) => repo(k + 1)) });

describe("listInstallationRepos", () => {
  it("maps GitHub's fields onto the summary shape", async () => {
    const { impl, calls } = stubFetch([
      {
        status: 200,
        body: { repositories: [{ id: 7, full_name: "acme/widgets", private: false, default_branch: "trunk" }] },
      },
    ]);
    const repos = await listInstallationRepos("ghs_token", impl);

    expect(repos).toEqual([{ githubRepoId: 7, name: "acme/widgets", visibility: "public", defaultBranch: "trunk" }]);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers?.authorization).toBe("Bearer ghs_token");
  });

  it("omits defaultBranch when GitHub did not report one", async () => {
    const { impl } = stubFetch([{ status: 200, body: { repositories: [{ id: 1, full_name: "a/b", private: true }] } }]);
    const [only] = await listInstallationRepos("t", impl);
    expect("defaultBranch" in only!).toBe(false);
  });

  it("skips entries missing an id or a full name instead of emitting a half-record", async () => {
    const { impl } = stubFetch([{ status: 200, body: { repositories: [{ id: 1 }, { full_name: "a/b" }, repo(3)] } }]);
    const repos = await listInstallationRepos("t", impl);
    expect(repos.map((r) => r.name)).toEqual(["acme/r3"]);
  });

  it("requests a second page when the first comes back full (100)", async () => {
    const { impl, calls } = stubFetch([
      { status: 200, body: page(100) },
      { status: 200, body: page(2) },
    ]);
    const repos = await listInstallationRepos("t", impl);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("page=1");
    expect(calls[1]!.url).toContain("page=2");
    expect(repos).toHaveLength(102);
  });

  it("stops after a short page", async () => {
    const { impl, calls } = stubFetch([{ status: 200, body: page(99) }]);
    expect(await listInstallationRepos("t", impl)).toHaveLength(99);
    expect(calls).toHaveLength(1);
  });

  it("stops at an empty page", async () => {
    const { impl, calls } = stubFetch([{ status: 200, body: { repositories: [] } }]);
    expect(await listInstallationRepos("t", impl)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("bounds the walk so a very large installation cannot hang the request", async () => {
    const { impl, calls } = stubFetch([{ status: 200, body: page(100) }]);
    await listInstallationRepos("t", impl, { maxPages: 3 });
    expect(calls).toHaveLength(3);
  });

  it("throws on a failed listing", async () => {
    const { impl } = stubFetch([{ status: 401 }]);
    await expect(listInstallationRepos("t", impl)).rejects.toThrow(RepoDiscoveryError);
  });

  it("honours an alternative API base (GitHub Enterprise)", async () => {
    const { impl, calls } = stubFetch([{ status: 200, body: { repositories: [] } }]);
    await listInstallationRepos("t", impl, { apiBase: "https://ghe.internal/api/v3" });
    expect(calls[0]!.url.startsWith("https://ghe.internal/api/v3/installation/repositories")).toBe(true);
  });
});

describe("visibility mapping", () => {
  async function visibilityOf(raw: Record<string, unknown>) {
    const { impl } = stubFetch([{ status: 200, body: { repositories: [{ id: 1, full_name: "a/b", ...raw }] } }]);
    return (await listInstallationRepos("t", impl))[0]!.visibility;
  }

  it("reports a repository GitHub calls not-private as public", async () => {
    expect(await visibilityOf({ private: false })).toBe("public");
  });

  it("reports a private repository as private", async () => {
    expect(await visibilityOf({ private: true })).toBe("private");
  });

  it("rounds internal down to private", async () => {
    // "internal" is org-wide visibility on GHEC. It is not public, and calling it public
    // would over-state how contained the repository is.
    expect(await visibilityOf({ visibility: "internal", private: false })).toBe("private");
  });

  it("lets the visibility string decide when both fields are present", async () => {
    expect(await visibilityOf({ visibility: "public", private: true })).toBe("public");
  });

  /*
   * The distinction the module exists for. "GitHub did not tell us" is not a quieter way of
   * saying "private" — a caller that renders `undefined` as a Lock icon has told an operator
   * their public repository is contained, which is precisely the false statement about
   * exposure this product cannot afford to make.
   */
  it("reports no visibility at all when GitHub supplied neither field", async () => {
    expect(await visibilityOf({})).toBeUndefined();
  });

  it("omits the key entirely rather than carrying an explicit undefined down the wire", async () => {
    const { impl } = stubFetch([{ status: 200, body: { repositories: [{ id: 1, full_name: "a/b" }] } }]);
    const [only] = await listInstallationRepos("t", impl);
    expect("visibility" in only!).toBe(false);
    expect(JSON.stringify(only)).not.toContain("visibility");
  });

  it("does not treat private:false as missing", async () => {
    // Guards the boolean check: `private: false` is an answer ("public"), not an absence.
    expect(await visibilityOf({ private: false })).toBe("public");
  });
});

describe("getRepoMetadata", () => {
  it("returns the repository summary", async () => {
    const { impl, calls } = stubFetch([
      { status: 200, body: { id: 7, full_name: "acme/widgets", private: false, default_branch: "main" } },
    ]);
    await expect(getRepoMetadata("acme/widgets", "t", impl)).resolves.toEqual({
      githubRepoId: 7,
      name: "acme/widgets",
      visibility: "public",
      defaultBranch: "main",
    });
    expect(calls[0]!.url).toBe("https://api.github.com/repos/acme/widgets");
  });

  it("returns undefined when the App cannot see the repository (404)", async () => {
    const { impl } = stubFetch([{ status: 404 }]);
    await expect(getRepoMetadata("acme/widgets", "t", impl)).resolves.toBeUndefined();
  });

  it("returns undefined when the App is not permitted to read it (403)", async () => {
    const { impl } = stubFetch([{ status: 403 }]);
    await expect(getRepoMetadata("acme/widgets", "t", impl)).resolves.toBeUndefined();
  });

  it("throws on a server error, which is a failure rather than an answer", async () => {
    const { impl } = stubFetch([{ status: 500 }]);
    await expect(getRepoMetadata("acme/widgets", "t", impl)).rejects.toThrow(RepoDiscoveryError);
  });

  it("refuses anything that is not an owner/name slug before making a request", async () => {
    const { impl, calls } = stubFetch([{ status: 200, body: {} }]);
    await expect(getRepoMetadata("/Users/me/proj", "t", impl)).rejects.toThrow(RepoDiscoveryError);
    await expect(getRepoMetadata("widgets", "t", impl)).rejects.toThrow(RepoDiscoveryError);
    await expect(getRepoMetadata("acme/widgets/extra", "t", impl)).rejects.toThrow(RepoDiscoveryError);
    expect(calls).toHaveLength(0);
  });
});

describe("REPO_SLUG", () => {
  it("accepts owner/name and nothing else", () => {
    expect(REPO_SLUG.test("acme/widgets")).toBe(true);
    expect(REPO_SLUG.test("acme-inc/my.repo_2")).toBe(true);
    expect(REPO_SLUG.test("/Users/me/proj")).toBe(false);
    expect(REPO_SLUG.test("acme")).toBe(false);
    expect(REPO_SLUG.test("acme/widgets/extra")).toBe(false);
  });
});

describe("createRepoDirectory", () => {
  it("binds the token into both reads", async () => {
    const { impl, calls } = stubFetch([
      { status: 200, body: { repositories: [repo(1)] } },
      { status: 200, body: repo(1) },
    ]);
    const dir = createRepoDirectory("ghs_bound", impl);

    expect((await dir.listInstallationRepos()).map((r) => r.name)).toEqual(["acme/r1"]);
    expect(await dir.getRepoMetadata("acme/r1")).toMatchObject({ name: "acme/r1" });
    expect(calls.every((c) => c.headers?.authorization === "Bearer ghs_bound")).toBe(true);
  });
});
