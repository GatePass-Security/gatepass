import { API_BASE, API_PROXY_BASE } from "./constants";
import type {
  OrgRecord,
  RepoRecord,
  ScanResult,
  FleetView,
  FleetServer,
  AgentGuidance,
  EvidenceExport,
  QuestionnaireDraft,
  BenchmarkData,
  ScanSummary,
  EvidenceExportResult,
  CompliancePlatform,
  ComplianceScanRecord,
  RemoteScanResult,
  FixPullRequestResult,
  GateConfig,
  GateResult,
  SessionInfo,
  Role,
  OrgMembershipSummary,
  AuthConfig,
  AuthResult,
  AvailableRepos,
  RepoSettingsPatch,
  ApiStatus,
} from "./types";
import type { Finding } from "./types";
import { ApiError } from "./types";

/**
 * Typed client for the Gatepass API (`apps/api/src/server.ts`).
 *
 * Every method below is backed by a route that exists in that router. Four were
 * removed in the redesign because they addressed routes the server never had —
 * `PATCH /orgs/:org/repos/:repo`, `GET /scans/:id`,
 * `GET /orgs/:org/questionnaires/:id`, and `POST /orgs/:org/integrations/:platform`
 * — and resolved as silent 404s behind optimistic UI. Where the dashboard still
 * needs the capability it calls the route that does exist: the old
 * `connectIntegration` is now `exportEvidence` →
 * `POST /orgs/:org/evidence/export`.
 *
 * `PATCH /orgs/:org/settings` was in the same broken set; rather than drop it,
 * the route was implemented (apps/api/src/server.ts), since the contract had
 * always specified it.
 *
 * Coverage: every route the router answers now has a method here, so no product
 * capability is reachable by curl but not by the dashboard. The three that are
 * not called from a page are `POST /v1/runner/results`, `POST /v1/benchmark/publish`
 * and `POST /v1/webhooks/github` — all three are machine-to-machine, carry
 * credentials the browser must never hold, and are surfaced on /system as
 * configuration state instead.
 */
/**
 * Which host this client talks to.
 *
 * In the browser it is the same-origin proxy (`/api/gp`), which reads the `httpOnly` session
 * cookie server-side and adds the bearer token. On the server it is the API directly, with the
 * token passed in. Either way the token never exists in browser JavaScript — see
 * `lib/session-cookie.ts` for why that constraint drove the design.
 */
function defaultBase(): string {
  return typeof window === "undefined" ? API_BASE : API_PROXY_BASE;
}

class ApiClient {
  private base: string;
  private token?: string;

  constructor(base: string = defaultBase(), token?: string) {
    this.base = base;
    this.token = token;
  }

  /** Authorization header, present only for a server-side client holding a session token. */
  private auth(): Record<string, string> {
    return this.token ? { authorization: `Bearer ${this.token}` } : {};
  }

  /**
   * How long a normal request waits. Ten seconds is right for an API that is already awake:
   * long enough for a slow query, short enough that a hung request does not leave a page
   * spinning.
   */
  private static readonly DEFAULT_TIMEOUT_MS = 10_000;

  private async request<T>(path: string, options: RequestInit = {}, timeoutMs?: number): Promise<T> {
    const url = `${this.base}/v1${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs ?? ApiClient.DEFAULT_TIMEOUT_MS);
    const externalSignal = options.signal;
    if (externalSignal) {
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    const { signal: _sig, ...rest } = options;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "content-type": "application/json", ...this.auth(), ...rest.headers },
        ...rest,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      /*
       * The API's own `error` string is preserved for every status, including
       * 404. It used to be replaced with a flat "Resource not found", which
       * discarded the one piece of information worth having — whether the org,
       * the scan or the finding was the thing that was missing. `explainError`
       * turns these into readable sentences; nothing renders them raw.
       */
      const body = (await res.json().catch(() => null)) as { error?: string; retryAfter?: number } | null;
      throw new ApiError(
        res.status,
        body?.error ?? `The API answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
        body?.retryAfter,
      );
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  /** `GET /healthz` — liveness probe, sits outside the `/v1` prefix. */
  async health(signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/healthz`, { signal, cache: "no-store" });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * `GET /healthz` again, but for the body rather than the status code — it
   * reports the service name, version, and the dashboard URL the API believes
   * it is paired with. Null when the host does not answer.
   */
  async status(signal?: AbortSignal): Promise<ApiStatus | null> {
    try {
      const res = await fetch(`${this.base}/healthz`, { signal, cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as ApiStatus;
    } catch {
      return null;
    }
  }

  // === ORGS ===
  /** `GET /v1/orgs/:org` */
  getOrg(orgId: string): Promise<OrgRecord> {
    return this.request(`/orgs/${orgId}`);
  }

  // === REPOSITORIES ===
  /** `GET /v1/orgs/:org/repos` — connected repositories. */
  getRepos(orgId: string): Promise<RepoRecord[]> {
    return this.request(`/orgs/${orgId}/repos`);
  }

  /**
   * `GET /v1/orgs/:org/repos/available` — repositories the Gatepass App installation can read
   * that this org has not connected yet. `configured: false` means the deployment has no
   * GitHub App, which is the normal case rather than an error.
   */
  getAvailableRepos(orgId: string): Promise<AvailableRepos> {
    return this.request(`/orgs/${orgId}/repos/available`);
  }

  /** `POST /v1/orgs/:org/repos { repo }` — connect `owner/name`. A GitHub read, never a write. */
  connectRepo(orgId: string, repo: string): Promise<RepoRecord> {
    return this.request(`/orgs/${orgId}/repos`, { method: "POST", body: JSON.stringify({ repo }) });
  }

  /**
   * `PATCH /v1/orgs/:org/repos/:repo` — per-repo gate settings. The repo name is a single
   * URL-encoded segment because it contains a slash.
   */
  patchRepo(orgId: string, repo: string, settings: RepoSettingsPatch): Promise<RepoRecord> {
    return this.request(`/orgs/${orgId}/repos/${encodeURIComponent(repo)}`, {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
  }

  /** `DELETE /v1/orgs/:org/repos/:repo` — disconnect. Scans already recorded are kept. */
  disconnectRepo(orgId: string, repo: string): Promise<{ ok: boolean; disconnected: string }> {
    return this.request(`/orgs/${orgId}/repos/${encodeURIComponent(repo)}`, { method: "DELETE" });
  }

  /**
   * `PATCH /v1/orgs/:org/settings` — org-scoped toggles.
   *
   * `fix_pr_enabled` is the org's opt-in for `openFixPullRequest` below. It is a
   * setting rather than a plan feature because it governs whether Gatepass may
   * write to a repository at all, which is a decision the org owns.
   */
  patchOrgSettings(
    orgId: string,
    settings: Partial<{ llm_analysis_enabled: boolean; agent_loop_enabled: boolean; fix_pr_enabled: boolean }>,
  ): Promise<OrgRecord> {
    return this.request(`/orgs/${orgId}/settings`, {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
  }

  // === SCANS ===

  /**
   * Scanning is the one operation that routinely outlives the shared 10s request budget: parsing
   * a tree takes tens of seconds on a real repository, and cloning one first takes longer still.
   *
   * A path scan used to run on the shared timeout, so the browser aborted at 10s while the API
   * carried on and wrote the scan anyway — the dashboard reported a failure for work that had in
   * fact succeeded, and the resulting scan only appeared after a manual reload.
   */
  private static readonly SCAN_TIMEOUT_MS = 180_000;

  /** `POST /v1/orgs/:org/scans` — scan a path already on the API host. */
  triggerScan(orgId: string, repoPath: string): Promise<ScanResult> {
    return this.longRunning<ScanResult>(`/orgs/${orgId}/scans`, JSON.stringify({ path: repoPath }));
  }

  /** `POST /v1/orgs/:org/scan-remote` — clone a GitHub repo and scan it. */
  scanRemoteRepo(orgId: string, repo: string, ref?: string): Promise<RemoteScanResult> {
    return this.longRunning<RemoteScanResult>(
      `/orgs/${orgId}/scan-remote`,
      JSON.stringify(ref ? { repo, ref } : { repo }),
    );
  }

  /** POST that opts out of the shared timeout in favour of the scan budget. */
  private async longRunning<T>(path: string, body: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ApiClient.SCAN_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.base}/v1${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        const parsed = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new ApiError(res.status, parsed?.error ?? `Scan failed (${res.status})`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** `GET /v1/orgs/:org/scans` — scan history with per-scan finding summaries. */
  listScans(orgId: string): Promise<ScanSummary[]> {
    return this.request(`/orgs/${orgId}/scans`);
  }

  /** `GET /v1/scans/:id/findings[?includeSuppressed=1]` */
  getFindings(scanId: string, includeSuppressed?: boolean): Promise<Finding[]> {
    const qs = includeSuppressed ? "?includeSuppressed=1" : "";
    return this.request(`/scans/${scanId}/findings${qs}`);
  }

  /** `GET /v1/scans/:id/findings.sarif` */
  getSarif(scanId: string): Promise<unknown> {
    return this.request(`/scans/${scanId}/findings.sarif`);
  }

  /**
   * `POST /v1/scans/:id/gate` — run the CI merge gate against a completed scan.
   *
   * `evaluateGate` is a pure function over the scan's findings, so this answers
   * "what would the gate have done?" without going near a pull request. That
   * matters: the gate is the product's blocking decision and the constitution
   * forbids writing to customer CI, so previewing it here is the only safe way
   * to tune a policy before turning it on.
   */
  evaluateGate(scanId: string, config: GateConfig): Promise<GateResult> {
    return this.request(`/scans/${scanId}/gate`, {
      method: "POST",
      body: JSON.stringify(config),
    });
  }

  /**
   * `POST /v1/orgs/:org/scans/:id/fix-pr` — open a pull request carrying this
   * scan's applicable fixes.
   *
   * The one route in this client that writes to a customer repository, and the
   * only one that may only be reached from an explicit human action: it creates
   * a new branch, never the default one, never CI configuration, and never
   * merges. Those guarantees live in `FixPullRequestOpener`, not here.
   *
   * Creating a branch, committing and opening the PR is several round trips to
   * GitHub, which can exceed the shared 10s budget, so — like `scanRemoteRepo`
   * — this opts out of it and carries its own longer timeout.
   */
  async openFixPullRequest(
    orgId: string,
    scanId: string,
    body: { fingerprints?: string[]; base?: string; requestedBy?: string } = {},
  ): Promise<FixPullRequestResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`${this.base}/v1/orgs/${orgId}/scans/${scanId}/fix-pr`, {
        method: "POST",
        // `this.auth()` is what every other call carries; omitting it here made this route —
        // the one the API guards at `admin` — answer 401 for a signed-in user. Any method
        // that opts out of `request()` for its own timeout has to re-add it by hand.
        headers: { "content-type": "application/json", ...this.auth() },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        // The API's own message is preserved verbatim — `explainError` maps every
        // failure this route produces (not opted in, no applicable fix, branch
        // exists, no GitHub repo, CI-config-only, not configured) onto a sentence.
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new ApiError(res.status, err?.error ?? `Opening the fix pull request failed (${res.status})`);
      }
      return (await res.json()) as FixPullRequestResult;
    } finally {
      clearTimeout(timeout);
    }
  }

  // === FINDINGS ===
  /** `POST /v1/findings/:fingerprint/dispute` */
  disputeFinding(fingerprint: string, scanId: string, reason: string): Promise<{ ok: boolean; suppressed: string }> {
    return this.request(`/findings/${encodeURIComponent(fingerprint)}/dispute`, {
      method: "POST",
      body: JSON.stringify({ scanId, reason }),
    });
  }

  /** `GET /v1/orgs/:org/scans/:id/agent-guidance?fingerprint=` */
  getAgentGuidance(orgId: string, scanId: string, fingerprint: string): Promise<AgentGuidance> {
    return this.request(`/orgs/${orgId}/scans/${scanId}/agent-guidance?fingerprint=${encodeURIComponent(fingerprint)}`);
  }

  // === FLEET ===
  /** `GET /v1/orgs/:org/fleet` */
  getFleet(orgId: string): Promise<FleetView> {
    return this.request(`/orgs/${orgId}/fleet`);
  }

  /** `POST /v1/orgs/:org/fleet/servers` */
  registerFleetServer(
    orgId: string,
    data: { name: string; endpointOrRepo: string; configHash: string },
  ): Promise<FleetServer> {
    return this.request(`/orgs/${orgId}/fleet/servers`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** `POST /v1/fleet/servers/:id/rescan` — note: no org segment, matching the router. */
  rescanFleetServer(serverId: string, repoPath: string): Promise<FleetServer> {
    return this.request(`/fleet/servers/${serverId}/rescan`, {
      method: "POST",
      body: JSON.stringify({ path: repoPath }),
    });
  }

  // === BENCHMARK (public — no org) ===
  /** `GET /v1/public/benchmark[/:corpusVersion]` */
  getBenchmark(corpusVersion?: string): Promise<BenchmarkData | BenchmarkData[]> {
    const path = corpusVersion ? `/public/benchmark/${corpusVersion}` : "/public/benchmark";
    return this.request(path);
  }

  // === COMPLIANCE ===
  /** `POST /v1/orgs/:org/compliance/scan` */
  complianceScan(orgId: string, repoPath: string): Promise<ComplianceScanRecord> {
    return this.request(`/orgs/${orgId}/compliance/scan`, {
      method: "POST",
      body: JSON.stringify({ repoPath }),
    });
  }

  /** `GET /v1/orgs/:org/compliance/results/:scanId` */
  complianceResult(orgId: string, scanId: string): Promise<ComplianceScanRecord> {
    return this.request(`/orgs/${orgId}/compliance/results/${scanId}`);
  }

  // === EVIDENCE ===
  /** `GET /v1/orgs/:org/evidence?scanId=` */
  getEvidence(orgId: string, scanId: string): Promise<EvidenceExport[]> {
    return this.request(`/orgs/${orgId}/evidence?scanId=${encodeURIComponent(scanId)}`);
  }

  /** `POST /v1/orgs/:org/evidence/export` — push evidence to Vanta/Drata. */
  exportEvidence(orgId: string, scanId: string, platform: CompliancePlatform): Promise<EvidenceExportResult> {
    return this.request(`/orgs/${orgId}/evidence/export`, {
      method: "POST",
      body: JSON.stringify({ scanId, platform }),
    });
  }

  /** `POST /v1/orgs/:org/questionnaires` */
  draftQuestionnaire(
    orgId: string,
    data: { scanId: string; format: string; content: string },
  ): Promise<QuestionnaireDraft> {
    return this.request(`/orgs/${orgId}/questionnaires`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // === AUTH ===
  /**
   * `GET /v1/auth/config` — which sign-in doors this deployment actually has.
   *
   * The login page renders from this rather than assuming GitHub is configured, so a machine
   * with no OAuth app shows the path that works instead of a button that dead-ends.
   */
  /**
   * Carries a cold-start budget rather than the shared ten seconds.
   *
   * This is the first request anybody makes, and on a platform that suspends an idle service it
   * is therefore the one most likely to arrive while nothing is listening. A free Render instance
   * takes roughly forty seconds to wake, so a ten-second deadline did not merely risk failing —
   * it *guaranteed* that the first visitor after any quiet period met "Can't reach the Gatepass
   * API" on a service that was healthy and simply asleep. Every later request in the session then
   * succeeded, which is what made it look intermittent.
   *
   * Sixty seconds is the wake time plus room, and it costs nothing when the API is up: a warm
   * config call answers in milliseconds and the timer is cleared. The only case that waits is the
   * case that used to fail.
   */
  private static readonly COLD_START_TIMEOUT_MS = 60_000;

  authConfig(signal?: AbortSignal): Promise<AuthConfig> {
    return this.request("/auth/config", signal ? { signal } : {}, ApiClient.COLD_START_TIMEOUT_MS);
  }

  /**
   * `GET /v1/auth/github/login?state=` — the GitHub authorize URL to redirect to.
   * Returns `{ url }` only when the API has OAuth credentials configured.
   */
  githubLoginUrl(state: string): Promise<{ url: string }> {
    return this.request(`/auth/github/login?state=${encodeURIComponent(state)}`);
  }

  /** `POST /v1/auth/github/callback { code }` — exchange the code for a session token. */
  githubCallback(code: string): Promise<AuthResult> {
    return this.request("/auth/github/callback", { method: "POST", body: JSON.stringify({ code }) });
  }

  /**
   * `POST /v1/auth/signout` — withdraw the bearer token this client is carrying.
   *
   * Idempotent, and never throws on an already-invalid token: signing out is the one operation
   * that must not fail in a way that leaves someone still signed in.
   */
  signOut(): Promise<{ ok: true; revoked: boolean }> {
    return this.request("/auth/signout", { method: "POST" });
  }

  /**
   * `GET /v1/auth/me` — the session's claims plus every org this GitHub account reaches.
   *
   * The org list is resolved live rather than read from the token, so an org somebody was
   * added to this morning appears without them signing in again, and one they were removed
   * from disappears.
   */
  authMe(): Promise<SessionInfo> {
    return this.request("/auth/me");
  }

  /**
   * `POST /v1/auth/switch-org { orgId }` — a fresh token for another org the same account
   * reaches. The API verifies the target against a live grant, so this cannot be used to reach
   * a tenant the account does not belong to.
   */
  switchOrg(orgId: string): Promise<{ token: string; orgId: string; role: Role }> {
    return this.request("/auth/switch-org", { method: "POST", body: JSON.stringify({ orgId }) });
  }

  /**
   * `POST /v1/auth/password { login, password }` — local account sign-in.
   *
   * Server-side only: this is called from the Route Handler that receives the form POST, so the
   * password never enters client JavaScript. A 401 is the single refusal for both "no such
   * account" and "wrong password"; a 429 means the attempt limiter is holding the door.
   */
  passwordSignIn(login: string, password: string): Promise<AuthResult> {
    return this.request("/auth/password", { method: "POST", body: JSON.stringify({ login, password }) });
  }

  /**
   * `POST /v1/auth/github/link { code }` — attach a GitHub account to the session this client
   * is carrying. The API takes the account to link from the session, never from the body.
   */
  linkGitHub(code: string): Promise<{ linked: { id: number; login: string }; orgs: OrgMembershipSummary[] }> {
    return this.request("/auth/github/link", { method: "POST", body: JSON.stringify({ code }) });
  }

  /** `POST /v1/auth/dev-session` — local development only; 403 anywhere it is not enabled. */
  devSession(login?: string): Promise<AuthResult> {
    return this.request("/auth/dev-session", { method: "POST", body: JSON.stringify(login ? { login } : {}) });
  }

  /**
   * `GET /v1/auth/me` — resolve a session token. Returns null on **401 only**, because "this
   * cookie is no longer good" is an ordinary answer the caller acts on by sending the user to
   * sign in, not an exception.
   *
   * Everything else throws. This used to swallow every failure into `null`, which made a
   * network blip or the client's own 10-second timeout indistinguishable from a refusal — so a
   * momentarily unreachable API signed people out, and the caller had no way to tell "your
   * session ended" from "we could not ask". Those need different answers: one clears the
   * cookie and shows the login page, the other must leave the cookie alone and say the API is
   * down, because clearing it would turn a brief outage into everybody signing in again.
   */
  async session(token: string): Promise<SessionInfo | null> {
    try {
      /*
       * Same cold-start budget as `authConfig`, for the same reason and with worse consequences.
       * This runs on every authenticated page load, so on a suspended instance a signed-in user
       * returning after lunch met an "API unreachable" page — while holding a perfectly good
       * session — and reloading fixed it only because the first attempt had woken the service.
       */
      return await this.request<SessionInfo>(
        "/auth/me",
        { headers: { authorization: `Bearer ${token}` } },
        ApiClient.COLD_START_TIMEOUT_MS,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  }
}

export const api = new ApiClient();
export default ApiClient;
