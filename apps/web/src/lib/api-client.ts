import { API_BASE } from "./constants";
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
  GateConfig,
  GateResult,
  SessionInfo,
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
class ApiClient {
  private base: string;

  constructor(base: string = API_BASE) {
    this.base = base;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.base}/v1${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const externalSignal = options.signal;
    if (externalSignal) {
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    const { signal: _sig, ...rest } = options;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "content-type": "application/json", ...rest.headers },
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

  /** `GET /v1/orgs/:org/repos` */
  getRepos(orgId: string): Promise<RepoRecord[]> {
    return this.request(`/orgs/${orgId}/repos`);
  }

  /** `PATCH /v1/orgs/:org/settings` — org-scoped analysis toggles. */
  patchOrgSettings(
    orgId: string,
    settings: Partial<{ llm_analysis_enabled: boolean; agent_loop_enabled: boolean }>,
  ): Promise<OrgRecord> {
    return this.request(`/orgs/${orgId}/settings`, {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
  }

  // === SCANS ===
  /** `POST /v1/orgs/:org/scans` — scan a path already on the API host. */
  triggerScan(orgId: string, repoPath: string): Promise<ScanResult> {
    return this.request(`/orgs/${orgId}/scans`, {
      method: "POST",
      body: JSON.stringify({ path: repoPath }),
    });
  }

  /**
   * `POST /v1/orgs/:org/scan-remote` — clone a GitHub repo and scan it.
   * Cloning takes longer than the default 10s budget, so this call opts out
   * of the shared timeout and carries its own longer one.
   */
  async scanRemoteRepo(orgId: string, repo: string, ref?: string): Promise<RemoteScanResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    try {
      const res = await fetch(`${this.base}/v1/orgs/${orgId}/scan-remote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ref ? { repo, ref } : { repo }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new ApiError(res.status, body?.error ?? `Scan failed (${res.status})`);
      }
      return (await res.json()) as RemoteScanResult;
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
   * `GET /v1/auth/github/login?state=` — the GitHub authorize URL to redirect to.
   * Returns `{ url }` only when the API has OAuth credentials configured.
   */
  githubLoginUrl(state: string): Promise<{ url: string }> {
    return this.request(`/auth/github/login?state=${encodeURIComponent(state)}`);
  }

  /**
   * `GET /v1/auth/me` — resolve a session token. Returns null on 401 rather than
   * throwing, because "no session" is the normal state for this dashboard: it
   * currently addresses a fixed org (`ORG_ID`) and never signs anyone in.
   */
  async session(token: string): Promise<SessionInfo | null> {
    try {
      return await this.request<SessionInfo>("/auth/me", {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      return null;
    }
  }
}

export const api = new ApiClient();
export default ApiClient;
