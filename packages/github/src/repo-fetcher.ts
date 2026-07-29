import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractTarGz } from "./tar.js";
import { getInstallationToken, type GitHubAppConfig } from "./auth.js";

/**
 * Repo fetching for clone-and-scan (§clone). Turns a GitHub repo + ref into a local
 * workspace the scan engine can read, then cleans it up. This is the bridge that lets
 * Gatepass scan a real GitHub repository instead of only a local path.
 *
 * Fetching uses the tarball API (contents:read only — no clone credentials, no write scope),
 * consistent with Principle III. The download step is injectable so the extract + scan flow
 * is unit-testable without a live token.
 */

export interface RepoWorkspace {
  /** Directory containing the extracted repo files (top dir stripped). */
  dir: string;
  /** The resolved commit SHA, if known. */
  sha?: string;
  cleanup(): Promise<void>;
}

export interface RepoFetcher {
  fetch(repo: string, ref: string): Promise<RepoWorkspace>;
}

/** Downloads a repo tarball as a Buffer. Injectable for tests. */
export type TarballDownloader = (repo: string, ref: string) => Promise<{ body: Buffer; sha?: string }>;

const MAX_TARBALL_BYTES = 512 * 1024 * 1024; // 512 MB safety cap

/**
 * Thrown when GitHub will not hand over a repository.
 *
 * A distinct type because the *reason* is the useful part and the status code alone hides it:
 * unauthenticated GitHub answers 404 for a private repository as well as a missing one — on
 * purpose, so that anonymous callers cannot enumerate private repos by their error codes.
 * Passing a bare "404" up to the dashboard would therefore tell an operator their repo does not
 * exist when the truth is that Gatepass has not been let in yet.
 */
export class RepoFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RepoFetchError";
  }
}

/** The one thing that differs between the authenticated and anonymous downloaders. */
type AuthHeaders = () => Promise<Record<string, string>>;

/**
 * Shared download path: resolve the ref to a commit, then pull the tarball.
 *
 * `explain` turns a refusal into something an operator can act on, and is the only other
 * difference between the two downloaders — what a 404 *means* depends entirely on whether we
 * presented credentials.
 */
function tarballDownloader(
  auth: AuthHeaders,
  explain: (repo: string, status: number, res: Response) => string,
  fetchImpl: typeof fetch,
): TarballDownloader {
  return async (repo, ref) => {
    const headers = {
      ...(await auth()),
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    };

    // Resolve the ref to its commit SHA first so findings are traceable to a real commit.
    // Best-effort: a failed resolution yields sha undefined — never a fabricated value.
    let sha: string | undefined;
    const shaRes = await fetchImpl(`https://api.github.com/repos/${repo}/commits/${ref}`, {
      headers: { ...headers, accept: "application/vnd.github.sha" },
    }).catch(() => undefined);
    if (shaRes?.ok) {
      const text = (await shaRes.text()).trim();
      if (/^[0-9a-f]{40}$/i.test(text)) sha = text;
    }

    const res = await fetchImpl(`https://api.github.com/repos/${repo}/tarball/${ref}`, {
      headers,
      redirect: "follow",
    });
    if (!res.ok) throw new RepoFetchError(explain(repo, res.status, res), res.status);
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_TARBALL_BYTES) throw new Error(`tarball for ${repo} exceeds size cap`);
    return { body: Buffer.from(ab), sha };
  };
}

/** Production downloader: fetch the tarball with a GitHub App installation token. */
export function githubTarballDownloader(config: GitHubAppConfig, fetchImpl: typeof fetch = fetch): TarballDownloader {
  return tarballDownloader(
    async () => ({ authorization: `Bearer ${await getInstallationToken(config).then((t) => t.token)}` }),
    (repo, status) =>
      status === 404
        ? `${repo} is not visible to this Gatepass installation. Install the Gatepass GitHub App on it, or check the name.`
        : `tarball download failed for ${repo} (${status})`,
    fetchImpl,
  );
}

/**
 * Anonymous downloader for public repositories.
 *
 * This exists so that clone-and-scan works on a deployment with no GitHub App configured yet.
 * Without it the entire remote-scan path is dark until credentials land, which means the one
 * capability that distinguishes Gatepass from a local linter — pointing it at a real repository
 * and watching it fetch, scan and clean up — cannot be demonstrated or tested at all.
 *
 * Public-only by construction: no token is sent, so GitHub returns exactly what any anonymous
 * client may see. It is not a way around access control; it is the absence of any claim to it.
 */
export function publicTarballDownloader(fetchImpl: typeof fetch = fetch): TarballDownloader {
  return tarballDownloader(
    async () => ({}),
    (repo, status, res) => {
      // GitHub signals anonymous exhaustion as 403 (or 429) with the remaining count at zero,
      // which reads as "forbidden" and sends people looking for a permissions problem.
      if ((status === 403 || status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
        return `GitHub's anonymous rate limit is exhausted (60 requests/hour per IP). Configure the Gatepass GitHub App to raise it.`;
      }
      return status === 404
        ? `${repo} was not found. Anonymous access can only reach public repositories — configure the Gatepass GitHub App to scan private ones.`
        : `tarball download failed for ${repo} (${status})`;
    },
    fetchImpl,
  );
}

/** Fetches by downloading + extracting a tarball into a temp workspace. */
export class TarballRepoFetcher implements RepoFetcher {
  constructor(private readonly download: TarballDownloader) {}

  async fetch(repo: string, ref: string): Promise<RepoWorkspace> {
    const { body, sha } = await this.download(repo, ref);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gatepass-scan-"));
    try {
      await extractTarGz(body, dir, { stripComponents: 1 });
    } catch (err) {
      await fs.rm(dir, { recursive: true, force: true });
      throw err;
    }
    return {
      dir,
      sha,
      cleanup: () => fs.rm(dir, { recursive: true, force: true }),
    };
  }
}

/** Dev/test fetcher: scans an existing local directory (no download, no cleanup). */
export class LocalDirFetcher implements RepoFetcher {
  async fetch(repo: string, _ref?: string): Promise<RepoWorkspace> {
    return { dir: repo, cleanup: async () => {} };
  }
}
