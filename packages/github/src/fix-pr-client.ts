import type { FixPullRequestClient, RepoFileContents } from "./fix-pr.js";

/**
 * Live GitHub REST implementation of `FixPullRequestClient` — the ONLY code in Gatepass that
 * calls a GitHub endpoint capable of changing a repository's contents. It needs a GitHub App
 * installation token with `contents:write` in addition to the read scopes.
 *
 * Every endpoint used here is listed, so an auditor can check the claim rather than take it:
 *
 *   GET  /repos/{repo}                          → default branch
 *   GET  /repos/{repo}/git/ref/heads/{branch}   → branch head sha
 *   POST /repos/{repo}/git/refs                 → CREATE a ref (never PATCH — see below)
 *   GET  /repos/{repo}/contents/{path}          → file content + blob sha
 *   PUT  /repos/{repo}/contents/{path}          → commit a file, on the fix branch only
 *   POST /repos/{repo}/pulls                    → open the PR
 *
 * Deliberately absent: `PATCH /git/refs/*` (the force-push endpoint), `DELETE /git/refs/*`,
 * `PUT /pulls/{n}/merge`, and anything under `/actions/`. There is no method on the
 * interface that would need them, and none should be added.
 *
 * `PUT /contents` always carries the blob `sha` read a moment earlier, so a concurrent write
 * is rejected by GitHub with a 409 instead of being clobbered.
 *
 * `fetchImpl` is injectable so request construction is unit-testable without a live token.
 */

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Endpoints a fix-PR client must never call, asserted at the request layer. */
const FORBIDDEN_ENDPOINT = /\/(actions|merge)(\/|$)/i;

export class RestFixPullRequestClient implements FixPullRequestClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly apiBase = "https://api.github.com",
  ) {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    };
  }

  private async call<T>(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; json: T }> {
    // A belt-and-braces check on the URL itself: no code path here should ever be able to
    // reach the Actions API or a merge endpoint, whatever a future caller passes in.
    if (FORBIDDEN_ENDPOINT.test(path)) {
      throw new Error(`refusing to call ${path}: Gatepass never touches CI configuration or merges a pull request`);
    }
    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers: this.headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = res.ok || res.status === 404 ? ((await res.json().catch(() => ({}))) as T) : ({} as T);
    return { ok: res.ok, status: res.status, json };
  }

  private async expect<T>(path: string, method: string, what: string, body?: unknown): Promise<T> {
    const res = await this.call<T>(path, method, body);
    if (!res.ok) throw new Error(`${what} failed: ${res.status}`);
    return res.json;
  }

  async getDefaultBranch(repo: string): Promise<string> {
    const json = await this.expect<{ default_branch?: string }>(`/repos/${repo}`, "GET", "getDefaultBranch");
    if (!json.default_branch) throw new Error(`getDefaultBranch failed: repository ${repo} reported no default branch`);
    return json.default_branch;
  }

  async getBranchSha(repo: string, branch: string): Promise<string> {
    const json = await this.expect<{ object?: { sha?: string } }>(
      `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      "GET",
      "getBranchSha",
    );
    const sha = json.object?.sha;
    if (!sha) throw new Error(`getBranchSha failed: no sha for ${branch}`);
    return sha;
  }

  async branchExists(repo: string, branch: string): Promise<boolean> {
    const res = await this.call(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, "GET");
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`branchExists failed: ${res.status}`);
    return true;
  }

  /**
   * `GET /repos/{repo}/pulls?head={owner}:{branch}&state=open`.
   *
   * GitHub wants the head qualified by owner, which for a same-repo branch is the repo's own
   * owner — the segment before the slash in `owner/name`. An unqualified head silently matches
   * nothing, which here would read as "no PR" and wrongly permit a second one.
   */
  async findOpenPullRequest(repo: string, branch: string): Promise<{ number: number; url: string } | undefined> {
    const owner = repo.split("/")[0] ?? "";
    const head = encodeURIComponent(`${owner}:${branch}`);
    const json = await this.expect<{ number?: number; html_url?: string }[]>(
      `/repos/${repo}/pulls?state=open&head=${head}`,
      "GET",
      "findOpenPullRequest",
    );
    const pr = Array.isArray(json) ? json[0] : undefined;
    return pr?.number ? { number: pr.number, url: pr.html_url ?? "" } : undefined;
  }

  async createBranch(repo: string, branch: string, fromSha: string): Promise<void> {
    // POST creates and fails on an existing ref. PATCH (which would update, and with
    // `force: true` overwrite) is never used — that is the force-push this module forbids.
    await this.expect(`/repos/${repo}/git/refs`, "POST", "createBranch", {
      ref: `refs/heads/${branch}`,
      sha: fromSha,
    });
  }

  async getFile(repo: string, ref: string, path: string): Promise<RepoFileContents> {
    const json = await this.expect<{ content?: string; encoding?: string; sha?: string }>(
      `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
      "GET",
      "getFile",
    );
    if (!json.sha || json.content === undefined) throw new Error(`getFile failed: ${path} is not a regular file`);
    return {
      content: Buffer.from(json.content, (json.encoding as BufferEncoding) ?? "base64").toString("utf8"),
      sha: json.sha,
    };
  }

  async putFile(args: {
    repo: string;
    branch: string;
    path: string;
    content: string;
    sha: string;
    message: string;
  }): Promise<void> {
    await this.expect(`/repos/${args.repo}/contents/${encodePath(args.path)}`, "PUT", "putFile", {
      message: args.message,
      content: Buffer.from(args.content, "utf8").toString("base64"),
      sha: args.sha,
      branch: args.branch,
    });
  }

  async createPullRequest(args: {
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<{ number: number; url: string }> {
    const json = await this.expect<{ number?: number; html_url?: string }>(
      `/repos/${args.repo}/pulls`,
      "POST",
      "createPullRequest",
      { title: args.title, head: args.head, base: args.base, body: args.body, maintainer_can_modify: true },
    );
    if (typeof json.number !== "number") throw new Error("createPullRequest failed: no pull request number returned");
    return { number: json.number, url: json.html_url ?? `https://github.com/${args.repo}/pull/${json.number}` };
  }
}

/** Encode a repo-relative path for a URL without escaping its separators. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
