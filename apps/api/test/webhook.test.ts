import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { createServer } from "../src/server.js";
import { TarballRepoFetcher, createTarGz, type TarballDownloader, type GitHubClient } from "@gatepass/github";

const SECRET = "whsec_test";
const download: TarballDownloader = async () => ({
  body: createTarGz({
    "acme-app-sha/dist/bundle.js": 'var k="AKIA3M7QZKPBW4NVXR2T";',
    "acme-app-sha/README.md": "# x",
  }),
  sha: "headsha1",
});

// Fake GitHub client capturing what the webhook would post.
const posted: string[] = [];
const fakeClient: GitHubClient = {
  async postReview(repo, pr) {
    posted.push(`review:${repo}#${pr}`);
    return { id: 1 };
  },
  async createCheckRun(repo, sha, result) {
    posted.push(`check:${repo}@${sha}:${result.conclusion}`);
    return { id: 2, conclusion: result.conclusion };
  },
};

let base: string;
let close: () => void;

beforeAll(async () => {
  const { server } = await createServer({
    repoFetcher: new TarballRepoFetcher(download),
    githubClient: fakeClient,
    webhookSecret: SECRET,
    webhookOrgId: "demo",
  });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  close = () => server.close();
});
afterAll(() => close());

function sign(body: string) {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}
async function sendWebhook(event: string, payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  const res = await fetch(base + "/v1/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": signature ?? sign(body),
    },
    body,
  });
  return { status: res.status, json: res.status < 500 ? await res.json().catch(() => ({})) : {} };
}

describe("GitHub webhook receiver (T072)", () => {
  it("rejects a forged signature (403), never scanning", async () => {
    const { status } = await sendWebhook("pull_request", { action: "opened" }, "sha256=forged");
    expect(status).toBe(403);
  });

  it("on a PR event: clone-scans and delivers a review + check run", async () => {
    posted.length = 0;
    const { status, json } = await sendWebhook("pull_request", {
      action: "opened",
      repository: { full_name: "acme/app" },
      pull_request: { number: 7, head: { sha: "headsha1", ref: "feature/x" } },
    });
    expect(status).toBe(202);
    expect((json as any).scanned).toBe(true);
    expect((json as any).verified).toBeGreaterThanOrEqual(1); // exposed secret in the bundle
    expect(posted).toContain("review:acme/app#7");
    expect(posted.some((c) => c.startsWith("check:acme/app@headsha1:failure"))).toBe(true);
  });

  it("ignores a closed PR (no scan)", async () => {
    const { status, json } = await sendWebhook("pull_request", {
      action: "closed",
      repository: { full_name: "acme/app" },
      pull_request: { number: 7, head: { sha: "x" } },
    });
    expect(status).toBe(202);
    expect((json as any).scanned).toBe(false);
  });

  it("reports only findings the PR introduced (incremental fair gate, T035)", async () => {
    const pr = (n: number) => ({
      action: "opened",
      repository: { full_name: "acme/incr" },
      pull_request: { number: n, head: { sha: `s${n}`, ref: "b" } },
    });
    const first = await sendWebhook("pull_request", pr(1));
    expect((first.json as any).incremental).toBe(false); // no baseline yet
    expect((first.json as any).verified).toBeGreaterThanOrEqual(1);

    posted.length = 0;
    const second = await sendWebhook("pull_request", pr(2)); // identical content
    expect((second.json as any).incremental).toBe(true);
    expect((second.json as any).added).toBe(0); // nothing new introduced
    // gate on the 2nd PR passes since no NEW verified findings were introduced
    expect(posted.some((c) => c.startsWith("check:acme/incr@s2:success"))).toBe(true);
  });
});
