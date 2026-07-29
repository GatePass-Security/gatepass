import type { GitHubClient, PostedReview, PostedCheckRun } from "./poster.js";
import type { PullReview } from "./review.js";
import type { GateResult } from "./checkrun.js";

/**
 * Live GitHub REST implementation of GitHubClient (FR-012/016, T096).
 *
 * Uses the REST API over `fetch` — no code-write endpoint is ever called (Principle III):
 *   - postReview   → POST /repos/{repo}/pulls/{n}/reviews  (event COMMENT, inline comments)
 *   - createCheckRun → POST /repos/{repo}/check-runs        (conclusion only, never patches code)
 *
 * `fetchImpl` is injectable so request construction is unit-testable without a live token.
 * In production, construct with a GitHub App installation token and the global fetch.
 */

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const CHECK_STATUS: Record<GateResult["conclusion"], "success" | "failure" | "neutral"> = {
  success: "success",
  failure: "failure",
  neutral: "neutral",
};

export class RestGitHubClient implements GitHubClient {
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

  async postReview(repo: string, prNumber: number, review: PullReview): Promise<PostedReview> {
    const body = JSON.stringify({
      event: review.event, // COMMENT — never REQUEST_CHANGES that could auto-block-merge silently
      body: review.summary,
      // `start_line`/`start_side` are what make a multi-line suggestion span its whole
      // range. Sending `line` alone collapses the anchor onto one line, and GitHub then
      // applies the suggestion there — rewriting a single line of a multi-line statement.
      comments: review.comments.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body,
        ...(c.startLine !== undefined ? { start_line: c.startLine, start_side: "RIGHT", side: "RIGHT" } : {}),
      })),
    });
    const res = await this.fetchImpl(`${this.apiBase}/repos/${repo}/pulls/${prNumber}/reviews`, {
      method: "POST",
      headers: this.headers(),
      body,
    });
    if (!res.ok) throw new Error(`postReview failed: ${res.status}`);
    const json = (await res.json()) as { id: number };
    return { id: json.id };
  }

  async createCheckRun(repo: string, headSha: string, result: GateResult): Promise<PostedCheckRun> {
    const body = JSON.stringify({
      name: "Gatepass",
      head_sha: headSha,
      status: "completed",
      conclusion: CHECK_STATUS[result.conclusion],
      output: { title: "Gatepass scan", summary: result.summary },
    });
    const res = await this.fetchImpl(`${this.apiBase}/repos/${repo}/check-runs`, {
      method: "POST",
      headers: this.headers(),
      body,
    });
    if (!res.ok) throw new Error(`createCheckRun failed: ${res.status}`);
    const json = (await res.json()) as { id: number };
    return { id: json.id, conclusion: result.conclusion };
  }
}
