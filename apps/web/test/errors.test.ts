import { describe, expect, it } from "vitest";
import { errorToast, explainError } from "../src/lib/errors";
import { ApiError } from "../src/lib/types";

/**
 * Every string in `API_MESSAGES` was captured from a running Gatepass API, not
 * invented — each one was produced by curling the route named beside it. That is
 * the point of this file: the mapping in `lib/errors.ts` is only worth anything
 * if it matches what the server actually says, and a handler that changes its
 * wording should fail here rather than silently start showing users a raw
 * internal string again.
 */
const API_MESSAGES = {
  // POST /v1/orgs/demo/scan-remote with no GitHub App configured
  noRepoFetcher: "no repo fetcher configured (set options.repoFetcher)",
  // POST /v1/orgs/demo/scans {"path":"/does/not/exist"}
  enoent: "ENOENT: no such file or directory, scandir '/does/not/exist'",
  // GET /v1/orgs/nope/scans
  unknownOrg: "org nope",
  // GET /v1/scans/<unknown>/findings
  unknownScan: "scan 00000000-0000-0000-0000-000000000000",
  // GET /v1/orgs/no-agent/scans/x/agent-guidance
  agentLoopOff: "agent-loop integration is not enabled for this org",
  // POST /v1/orgs/demo/evidence/export with no VANTA_API_TOKEN
  noVantaToken: "no vanta API token configured",
  // packages/shared/src/plan-tier.ts
  planTier: 'Feature "fleet" requires a higher plan than "free"',
  // POST /v1/orgs/demo/scan-remote {"repo":"acme/private"} with no GitHub App configured
  publicOnly404:
    "acme/private was not found. Anonymous access can only reach public repositories — configure the Gatepass GitHub App to scan private ones.",
  // The same route once GitHub's 60/hour anonymous quota is spent
  anonRateLimit:
    "GitHub's anonymous rate limit is exhausted (60 requests/hour per IP). Configure the Gatepass GitHub App to raise it.",
  // POST /v1/orgs/demo/scan-remote for a repo the installed App was not given
  notInstalled:
    "acme/app is not visible to this Gatepass installation. Install the Gatepass GitHub App on it, or check the name.",
} as const;

describe("explainError — messages this API genuinely produces", () => {
  it("turns the missing GitHub App into a cause and a way forward", () => {
    const e = explainError(new ApiError(500, API_MESSAGES.noRepoFetcher));
    expect(e.kind).toBe("unconfigured");
    // The headline must not be the raw string, and must not name an internal option.
    expect(e.title).not.toContain("repo fetcher");
    expect(e.title.toLowerCase()).toContain("github");
    // The alternative that works right now matters more than the env-var list, and the two
    // land in different fields on purpose: `action` is what this reader can do, `operator` is
    // what whoever runs the deployment must set. Both are rendered (ui/EmptyState).
    expect(e.action).toMatch(/Path on host/);
    expect(e.operator).toMatch(/GITHUB_APP_ID/);
    expect(e.retryable).toBe(false);
    // The original is kept for a bug report, just not as the headline.
    expect(e.technical).toBe(API_MESSAGES.noRepoFetcher);
  });

  it("reads a raw ENOENT back as the path the user typed", () => {
    const e = explainError(new ApiError(500, API_MESSAGES.enoent));
    expect(e.kind).toBe("invalid");
    expect(e.detail).toContain("/does/not/exist");
    // The distinction that actually confuses people about this route.
    expect(e.detail).toMatch(/machine running the API/);
    expect(e.title).not.toContain("ENOENT");
  });

  it("names the resource in a NotFoundError instead of echoing its id", () => {
    const org = explainError(new ApiError(404, API_MESSAGES.unknownOrg));
    expect(org.kind).toBe("notFound");
    expect(org.title).toContain("organization");
    expect(org.title).not.toBe("org nope");

    const scan = explainError(new ApiError(404, API_MESSAGES.unknownScan));
    expect(scan.title).toContain("scan");
    expect(scan.action).toMatch(/Scans page/);
  });

  it("treats an opt-in feature being off as configuration, not failure", () => {
    const e = explainError(new ApiError(403, API_MESSAGES.agentLoopOff));
    expect(e.kind).toBe("unconfigured");
    expect(e.action).toMatch(/Settings/);
  });

  it("names the platform when a compliance token is missing", () => {
    const e = explainError(new ApiError(403, API_MESSAGES.noVantaToken));
    expect(e.title).toContain("Vanta");
    expect(e.operator).toContain("VANTA_API_TOKEN");
  });

  it("explains a plan gate in terms of the plan", () => {
    const e = explainError(new ApiError(403, API_MESSAGES.planTier));
    expect(e.kind).toBe("denied");
    expect(e.detail).toContain("fleet");
    expect(e.detail).toContain("free");
  });
});

describe("explainError — transport failures", () => {
  it("reports an unreachable API rather than a fetch stack trace", () => {
    const e = explainError(new TypeError("Failed to fetch"));
    expect(e.kind).toBe("offline");
    expect(e.retryable).toBe(true);
    expect(e.title).not.toContain("fetch");
  });

  it("distinguishes an aborted request from a server error", () => {
    const e = explainError(new DOMException("aborted", "AbortError"), { action: "clone that repository" });
    expect(e.kind).toBe("timeout");
    expect(e.detail).toContain("clone that repository");
    expect(e.retryable).toBe(true);
  });

  it("surfaces the reset window on a rate limit", () => {
    const e = explainError(new ApiError(429, "rate limit exceeded", 42));
    expect(e.kind).toBe("rateLimited");
    expect(e.detail).toContain("42 seconds");
  });
});

describe("explainError — fallbacks", () => {
  it("never renders an empty message for an unrecognised failure", () => {
    for (const thrown of [new Error("something odd"), "a bare string", null, undefined, 42, {}]) {
      const e = explainError(thrown, { action: "do the thing" });
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.detail.length).toBeGreaterThan(0);
    }
  });

  it("does not claim a 5xx is the user's fault", () => {
    const e = explainError(new ApiError(500, "boom"), { action: "load the fleet" });
    expect(e.kind).toBe("server");
    expect(e.retryable).toBe(true);
    expect(e.status).toBe(500);
  });

  it("keeps a toast to one line", () => {
    const line = errorToast(new ApiError(500, API_MESSAGES.noRepoFetcher));
    expect(line).not.toContain("\n");
    expect(line.length).toBeGreaterThan(0);
  });
});

/**
 * Anonymous clone-and-scan turns one HTTP status into three unrelated situations, and the
 * status alone gets all three wrong: 404 usually means "private", and 403 usually means "quota",
 * not "denied". These three rules are the whole reason the API's messages are worded the way
 * they are, so they are worth pinning.
 */
describe("explainError — anonymous clone-and-scan refusals", () => {
  it("says a 404 may mean private, not missing — and names the repo", () => {
    const e = explainError(new ApiError(500, API_MESSAGES.publicOnly404));
    expect(e.title).toContain("acme/private");
    // The trap this rule exists to avoid: sending someone to check their spelling when the
    // real answer is that Gatepass was never granted access.
    expect(e.detail).toMatch(/private/i);
    expect(e.operator).toMatch(/GITHUB_APP_ID/);
    expect(e.retryable).toBe(false);
  });

  it("reads an exhausted quota as a quota, and as retryable", () => {
    const e = explainError(new ApiError(500, API_MESSAGES.anonRateLimit));
    expect(e.kind).toBe("unconfigured");
    // 403 would otherwise render as a permissions problem, which it is not.
    expect(e.title).not.toMatch(/denied|forbidden|permission/i);
    expect(e.retryable).toBe(true);
  });

  it("distinguishes 'the App cannot see it' from 'it does not exist'", () => {
    const e = explainError(new ApiError(500, API_MESSAGES.notInstalled));
    expect(e.kind).toBe("denied");
    expect(e.title).toContain("acme/app");
    expect(e.action).toMatch(/install/i);
  });
});

describe("explainError — a capability this deployment does not have", () => {
  /*
   * 501 lives in the 5xx range but is not a fault: the API is telling us an operator has not
   * configured something. Falling through to the generic 5xx branch would style it red and
   * offer "Try again", and retrying a missing credential never once succeeds.
   */
  it("reads a bare 501 as configuration rather than failure", () => {
    // Deliberately a message no PATTERN rule matches, so this exercises the status branch
    // itself rather than a specific rule that would have produced the same answer anyway.
    const e = explainError(new ApiError(501, "capability xyzzy is unavailable here"));
    expect(e.kind).toBe("unconfigured");
    expect(e.retryable).toBe(false);
    expect(e.title).not.toMatch(/error|wrong|failed/i);
  });

  it("still prefers a specific message rule over the status", () => {
    const e = explainError(new ApiError(501, "fix pull requests are not configured on this deployment"));
    expect(e.kind).toBe("unconfigured");
    // The specific rule names the feature; the generic 501 branch could not.
    expect(e.title.toLowerCase()).toContain("pull request");
  });
});

/**
 * The failure mode that took a deployed dashboard down: no API URL configured, so the server
 * fell back to its own loopback and every page — sign-in included — got nothing.
 *
 * What is pinned here is the *diagnosis*, because the old one was actively wrong. It told
 * whoever was on call to start a local API process, on a host they were not looking at, when
 * the fix was one environment variable. A message that sends someone to the wrong machine is
 * worse than no message.
 */
describe("explainError — a dashboard with no API URL configured", () => {
  it("blames the missing variable, not a process nobody was meant to run", () => {
    const e = explainError(new TypeError("Failed to fetch"));
    expect(e.kind).toBe("offline");
    expect(e.operator).toBeDefined();
    // Under test, GATEPASS_API_URL is unset — exactly the deployed-and-unconfigured case.
    expect(e.operator).toMatch(/GATEPASS_API_URL/);
    expect(e.operator).not.toMatch(/pnpm --filter/);
  });
});
