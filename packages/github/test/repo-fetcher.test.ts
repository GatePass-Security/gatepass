import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractTarGz,
  createTarGz,
  TarSlipError,
  TarballRepoFetcher,
  LocalDirFetcher,
  RepoFetchError,
  publicTarballDownloader,
  type TarballDownloader,
} from "../src/index.js";

const tmpDirs: string[] = [];
async function tmp() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "gp-tar-"));
  tmpDirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe("tar.gz extraction (clone-and-scan)", () => {
  it("round-trips files through create → extract", async () => {
    const tar = createTarGz({ "src/index.ts": "export const x = 1;", "README.md": "# hi" });
    const dir = await tmp();
    const written = await extractTarGz(tar, dir);
    expect(written.sort()).toEqual(["README.md", "src/index.ts"]);
    expect(await fs.readFile(path.join(dir, "src/index.ts"), "utf8")).toBe("export const x = 1;");
  });

  it("strips leading components (GitHub tarball top dir)", async () => {
    const tar = createTarGz({ "owner-repo-abc123/src/app.ts": "code", "owner-repo-abc123/package.json": "{}" });
    const dir = await tmp();
    await extractTarGz(tar, dir, { stripComponents: 1 });
    expect(await fs.readFile(path.join(dir, "src/app.ts"), "utf8")).toBe("code");
  });

  it("REJECTS a tar-slip path-traversal entry (scanner must not be exploitable)", async () => {
    const tar = createTarGz({ "../../etc/evil": "pwned" });
    const dir = await tmp();
    await expect(extractTarGz(tar, dir)).rejects.toThrow(TarSlipError);
  });

  it("rejects a non-gzip buffer", async () => {
    const dir = await tmp();
    await expect(extractTarGz(Buffer.from("not a gzip"), dir)).rejects.toThrow();
  });
});

describe("TarballRepoFetcher", () => {
  it("downloads → extracts → exposes a workspace, then cleans up", async () => {
    const download: TarballDownloader = async () => ({
      body: createTarGz({ "repo-sha/mcp/tools.json": '{"tools":[]}', "repo-sha/src/a.ts": "x" }),
      sha: "deadbeef",
    });
    const fetcher = new TarballRepoFetcher(download);
    const ws = await fetcher.fetch("acme/app", "main");
    expect(await fs.readFile(path.join(ws.dir, "src/a.ts"), "utf8")).toBe("x");
    expect(ws.sha).toBe("deadbeef");
    await ws.cleanup();
    await expect(fs.access(ws.dir)).rejects.toBeTruthy(); // gone after cleanup
  });
});

/**
 * The anonymous downloader is what makes clone-and-scan work before any GitHub App exists, so
 * these tests pin the two things that make it safe to offer: it presents no credential, and it
 * explains a refusal in terms an operator can act on.
 */
describe("publicTarballDownloader", () => {
  /** Minimal stand-in for the two calls the downloader makes. */
  function fakeFetch(responses: Record<string, { status: number; body?: Buffer; headers?: Record<string, string> }>) {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      const match = Object.keys(responses).find((k) => url.includes(k));
      const r = match ? responses[match]! : { status: 404 };
      return new Response(r.body ?? "", { status: r.status, headers: r.headers });
    }) as unknown as typeof fetch;
    return { impl, seen };
  }

  it("sends NO authorization header — it claims no access it has not been granted", async () => {
    const tar = createTarGz({ "repo-sha/a.ts": "x" });
    const { impl, seen } = fakeFetch({
      "/commits/": { status: 200, body: Buffer.from("a".repeat(40)) },
      "/tarball/": { status: 200, body: tar },
    });
    await publicTarballDownloader(impl)("acme/app", "HEAD");
    expect(seen).toHaveLength(2);
    for (const call of seen) {
      expect(Object.keys(call.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    }
  });

  it("resolves the ref to a commit SHA so findings are pinned", async () => {
    const sha = "b".repeat(40);
    const { impl } = fakeFetch({
      "/commits/": { status: 200, body: Buffer.from(sha) },
      "/tarball/": { status: 200, body: createTarGz({ "repo-sha/a.ts": "x" }) },
    });
    expect((await publicTarballDownloader(impl)("acme/app", "main")).sha).toBe(sha);
  });

  it("never fabricates a SHA when the ref cannot be resolved", async () => {
    const { impl } = fakeFetch({
      "/commits/": { status: 404 },
      "/tarball/": { status: 200, body: createTarGz({ "repo-sha/a.ts": "x" }) },
    });
    expect((await publicTarballDownloader(impl)("acme/app", "main")).sha).toBeUndefined();
  });

  it("explains a 404 as 'public only', because GitHub hides private repos behind the same code", async () => {
    const { impl } = fakeFetch({ "/tarball/": { status: 404 } });
    await expect(publicTarballDownloader(impl)("acme/private", "HEAD")).rejects.toThrow(
      /acme\/private was not found.*public repositories/is,
    );
  });

  it("names rate-limit exhaustion rather than reporting it as a permissions failure", async () => {
    const { impl } = fakeFetch({
      "/tarball/": { status: 403, headers: { "x-ratelimit-remaining": "0" } },
    });
    await expect(publicTarballDownloader(impl)("acme/app", "HEAD")).rejects.toThrow(/rate limit is exhausted/i);
  });

  it("does not mistake an ordinary 403 for rate limiting", async () => {
    const { impl } = fakeFetch({
      "/tarball/": { status: 403, headers: { "x-ratelimit-remaining": "58" } },
    });
    const err = await publicTarballDownloader(impl)("acme/app", "HEAD").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepoFetchError);
    expect((err as RepoFetchError).status).toBe(403);
    expect((err as Error).message).not.toMatch(/rate limit/i);
  });
});

describe("LocalDirFetcher", () => {
  it("returns the given directory unchanged", async () => {
    const ws = await new LocalDirFetcher().fetch("corpus/eval-repos/vulnerable-nextjs-mcp", "main");
    expect(ws.dir).toBe("corpus/eval-repos/vulnerable-nextjs-mcp");
    await ws.cleanup(); // no-op
  });
});
