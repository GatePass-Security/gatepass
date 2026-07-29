/**
 * Read-only repository discovery for the "connect a repository" flow.
 *
 * Two GET endpoints, nothing else:
 *   - GET /installation/repositories  → what the Gatepass App installation can see
 *   - GET /repos/{owner}/{name}       → one repository's metadata
 *
 * Connecting a repository is a read operation and this module keeps it one — there is no
 * write method here and there must never be one (Constitution Principle III; CLAUDE.md rule 2).
 * That is why this lives beside `RestGitHubClient` rather than inside it: the `GitHubClient`
 * interface is the audited outbound-write surface, and repository *discovery* has no business
 * widening it.
 *
 * `visibility` is the reason this file exists. The repos list used to print the literal
 * `"private"` for every row without ever asking GitHub. Here it is read from the API or it is
 * absent — a caller that cannot reach GitHub gets `undefined` and must render nothing.
 *
 * That "or it is absent" is load-bearing and is why `visibility` is an OPTIONAL field rather
 * than a required one with a fallback. There is no safe default: printing "Private" beside a
 * public repository tells an operator something false about their exposure, and printing
 * "Public" beside a private one is worse. A repository this module never saw through an
 * installation — a directory scanned by path on the API host, say — has no GitHub visibility
 * to report at all, and the type says so instead of inventing one.
 */

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface GitHubRepoSummary {
  githubRepoId: number;
  /** `owner/name`. */
  name: string;
  /**
   * What GitHub said, or absent. Never inferred: a payload carrying neither `private` nor
   * `visibility` yields `undefined`, and the key is omitted from the object entirely so it
   * cannot be serialised as an explicit `null` further down the wire.
   */
  visibility?: "public" | "private";
  defaultBranch?: string;
}

export class RepoDiscoveryError extends Error {}

/** `owner/name`, the only shape either endpoint accepts. */
export const REPO_SLUG = /^[\w.-]+\/[\w.-]+$/;

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

/**
 * GitHub reports both a boolean `private` and (on newer payloads) a `visibility` string that
 * can also be `"internal"`.
 *
 * Two different questions, kept separate on purpose:
 *
 *  - *GitHub answered, but ambiguously* — `"internal"` (org-wide on GHEC) is not public, and
 *    calling it public would over-state how contained the repository is. So a known-but-not-
 *    public answer rounds down to `"private"`.
 *  - *GitHub did not answer at all* — neither field present. That is not an ambiguous answer,
 *    it is the absence of one, and it returns `undefined`. Rounding this case down to
 *    `"private"` would manufacture a fact about a repository's exposure out of a gap in a
 *    payload, which is the failure mode this whole module was written to remove.
 */
function visibilityOf(raw: { private?: boolean; visibility?: string }): "public" | "private" | undefined {
  if (raw.visibility) return raw.visibility === "public" ? "public" : "private";
  if (typeof raw.private === "boolean") return raw.private ? "private" : "public";
  return undefined;
}

function toSummary(raw: unknown): GitHubRepoSummary | undefined {
  const r = raw as { id?: number; full_name?: string; private?: boolean; visibility?: string; default_branch?: string };
  if (typeof r.id !== "number" || typeof r.full_name !== "string") return undefined;
  const visibility = visibilityOf(r);
  return {
    githubRepoId: r.id,
    name: r.full_name,
    // Spread rather than assign, so an unknown visibility leaves no key behind at all.
    ...(visibility ? { visibility } : {}),
    ...(r.default_branch ? { defaultBranch: r.default_branch } : {}),
  };
}

/**
 * Every repository the installation token can read, one page at a time (GitHub caps at 100).
 * `maxPages` bounds the walk so a very large installation cannot hang a request forever.
 */
export async function listInstallationRepos(
  token: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  { apiBase = "https://api.github.com", maxPages = 5 }: { apiBase?: string; maxPages?: number } = {},
): Promise<GitHubRepoSummary[]> {
  const out: GitHubRepoSummary[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchImpl(`${apiBase}/installation/repositories?per_page=100&page=${page}`, {
      method: "GET",
      headers: headers(token),
    });
    if (!res.ok) throw new RepoDiscoveryError(`listing installation repositories failed (${res.status})`);
    const body = (await res.json()) as { repositories?: unknown[] };
    const batch = Array.isArray(body.repositories) ? body.repositories : [];
    for (const raw of batch) {
      const summary = toSummary(raw);
      if (summary) out.push(summary);
    }
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * One repository's metadata. Returns undefined for 404/403 — "the App cannot see this repo" is
 * an answer, not a failure, and the caller connects it without a visibility rather than erroring.
 */
export async function getRepoMetadata(
  repo: string,
  token: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  apiBase = "https://api.github.com",
): Promise<GitHubRepoSummary | undefined> {
  if (!REPO_SLUG.test(repo)) throw new RepoDiscoveryError(`"${repo}" is not an owner/name repository slug`);
  const res = await fetchImpl(`${apiBase}/repos/${repo}`, { method: "GET", headers: headers(token) });
  if (res.status === 404 || res.status === 403) return undefined;
  if (!res.ok) throw new RepoDiscoveryError(`reading repository ${repo} failed (${res.status})`);
  return toSummary(await res.json());
}

/**
 * The capability the API hands its handlers, so they depend on an interface rather than on a
 * live token. Absent ⇒ the deployment has no GitHub App and the connect-by-installation flow
 * reports itself unavailable instead of failing mid-request.
 */
export interface RepoDirectory {
  listInstallationRepos(): Promise<GitHubRepoSummary[]>;
  getRepoMetadata(repo: string): Promise<GitHubRepoSummary | undefined>;
}

/** Bind a live installation token into a `RepoDirectory`. */
export function createRepoDirectory(token: string, fetchImpl?: FetchLike, apiBase?: string): RepoDirectory {
  return {
    listInstallationRepos: () => listInstallationRepos(token, fetchImpl, apiBase ? { apiBase } : {}),
    getRepoMetadata: (repo: string) => getRepoMetadata(repo, token, fetchImpl, apiBase),
  };
}
