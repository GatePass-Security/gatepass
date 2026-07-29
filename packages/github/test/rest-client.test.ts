import { describe, it, expect } from "vitest";
import { RestGitHubClient, buildReview, evaluateGate } from "../src/index.js";
import type { Finding } from "@gatepass/findings";

const verified: Finding = {
  fingerprint: "sha256:a",
  tier: "verified",
  classId: "exposed-secret",
  severity: "critical",
  surfaces: ["app_code"],
  locations: [{ path: "a.js", startLine: 1, endLine: 1, surface: "app_code" }],
  explanation: "secret",
  reproduction: { kind: "inspection", steps: ["look"], expected: "leak" },
};

function fakeFetch(capture: { url?: string; init?: any }, response: unknown = { id: 99 }) {
  return async (url: string, init: any) => {
    capture.url = url;
    capture.init = init;
    return { ok: true, status: 201, json: async () => response };
  };
}

describe("RestGitHubClient (T096) — request construction", () => {
  it("posts a PR review to the correct endpoint with a bearer token, COMMENT event", async () => {
    const cap: { url?: string; init?: any } = {};
    const client = new RestGitHubClient("tok123", fakeFetch(cap));
    const posted = await client.postReview("acme/app", 42, buildReview([verified]));
    expect(cap.url).toBe("https://api.github.com/repos/acme/app/pulls/42/reviews");
    expect(cap.init.method).toBe("POST");
    expect(cap.init.headers.authorization).toBe("Bearer tok123");
    const body = JSON.parse(cap.init.body);
    expect(body.event).toBe("COMMENT");
    expect(body.comments[0].path).toBe("a.js");
    expect(posted.id).toBe(99);
  });

  /*
   * GitHub needs `start_line` (with the sides named) to apply a suggestion across a range.
   * Sending `line` alone collapses the anchor onto one line, and the suggestion then rewrites
   * a single line of a multi-line statement.
   */
  it("maps a multi-line anchor to start_line/start_side, and omits them for a single line", async () => {
    const cap: { url?: string; init?: any } = {};
    const client = new RestGitHubClient("tok", fakeFetch(cap));
    await client.postReview("acme/app", 1, {
      event: "COMMENT",
      summary: "s",
      comments: [
        { path: "db/schema.sql", startLine: 1, line: 5, body: "multi" },
        { path: "src/a.ts", line: 9, body: "single" },
      ],
    });
    const body = JSON.parse(cap.init.body);
    expect(body.comments[0]).toMatchObject({ line: 5, start_line: 1, start_side: "RIGHT", side: "RIGHT" });
    expect(body.comments[1]).not.toHaveProperty("start_line");
    expect(body.comments[1].line).toBe(9);
  });

  it("creates a check run with the gate conclusion (no code write)", async () => {
    const cap: { url?: string; init?: any } = {};
    const client = new RestGitHubClient("tok", fakeFetch(cap));
    const result = evaluateGate(
      { mode: "block_verified", failureMode: "fail_open" },
      { findings: [verified], scanCompleted: true },
    );
    const posted = await client.createCheckRun("acme/app", "abc123", result);
    expect(cap.url).toBe("https://api.github.com/repos/acme/app/check-runs");
    const body = JSON.parse(cap.init.body);
    expect(body.head_sha).toBe("abc123");
    expect(body.conclusion).toBe("failure");
    expect(posted.conclusion).toBe("failure");
  });

  it("throws on a non-ok response", async () => {
    const client = new RestGitHubClient("tok", async () => ({ ok: false, status: 403, json: async () => ({}) }) as any);
    await expect(client.postReview("acme/app", 1, buildReview([verified]))).rejects.toThrow(/403/);
  });
});
