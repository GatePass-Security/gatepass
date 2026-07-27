import { randomUUID, createHash } from "node:crypto";
import { buildScanContext, detectFrameworks } from "@gatepass/engine";
import { runScan, runScanAsync, generateSuggestedFix } from "@gatepass/detectors";
import { LlmGateway } from "@gatepass/semantic";
import { toSarif, parseFindingsDocument, diffFindings, type Finding } from "@gatepass/findings";
import {
  evaluateGate,
  verifyAndParseWebhook,
  shouldScan,
  Remediator,
  type GateConfig,
  type WebhookHeaders,
} from "@gatepass/github";
import {
  AuditedWriter,
  InMemoryAuditSink,
  createSession,
  verifySession,
  type Role,
  type Session,
} from "@gatepass/shared";
import { authorizeUrl, exchangeCodeForUser, type OAuthConfig } from "@gatepass/github";
import {
  evaluatePosture,
  draftAnswers,
  ingest,
  ApiEvidenceExporter,
  type Scan as PostureScan,
  type SourceFormat,
  type CompliancePlatform,
} from "@gatepass/evidence";
import { requireFeature, type PlanTier } from "@gatepass/shared";
import { validateRunnerUpload } from "@gatepass/runner";
import { scoreTool, type CorpusCaseLabel, type Detection } from "@gatepass/benchmark";
import { runComplianceScan } from "@gatepass/compliance";
import type { Store, StoredScan, FleetServer, OrgRecord } from "./store.js";

/**
 * API handlers wiring the analysis, gate, evidence, and runner libraries over the store.
 * Pure functions (request â†’ result) so they are unit-testable without a running server; the
 * HTTP binding in server.ts is a thin adapter. RBAC/auth and DB persistence are the two
 * production swap-ins (both stubbed here as an in-memory store + trusted caller).
 */

const RULESET_VERSION = "2026.07.0";

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}

import type { LlmTransport } from "@gatepass/semantic";
import type { GitHubClient, RepoFetcher } from "@gatepass/github";

export interface HandlerOptions {
  /** LLM transport for research-tier refinement. Production wires the NVIDIA NIM transport;
   *  absent means static-only (research findings keep heuristic confidence). */
  llmTransport?: LlmTransport;
  llmModel?: string;
  /** GitHub App client for PR review and check-run delivery (T096). */
  githubClient?: GitHubClient;
  /** Repo fetcher for clone-and-scan of real GitHub repos (Â§clone). */
  repoFetcher?: RepoFetcher;
  /** GitHub webhook secret for signature verification (T072). */
  webhookSecret?: string;
  /** Org that webhook-triggered scans run under (installationâ†’org mapping; MVP default). */
  webhookOrgId?: string;
  /** Compliance-platform API tokens for evidence export (T083). */
  vantaToken?: string;
  drataToken?: string;
  /** GitHub OAuth sign-in config + session secret (FR-027, T076). */
  oauthConfig?: OAuthConfig;
  sessionSecret?: string;
  /** Injectable fetch for the OAuth exchange (tests). */
  oauthFetch?: typeof fetch;
}

export function makeHandlers(store: Store, options: HandlerOptions = {}) {
  const requireScan = async (scanId: string): Promise<StoredScan> => {
    const s = await store.getScan(scanId);
    if (!s) throw new NotFoundError(`scan ${scanId}`);
    return s;
  };
  const requireOrg = async (orgId: string): Promise<OrgRecord> => {
    const o = await store.getOrg(orgId);
    if (!o) throw new NotFoundError(`org ${orgId}`);
    return o;
  };
  const asPostureScan = async (s: StoredScan): Promise<PostureScan> => ({
    id: s.doc.scan.id,
    rulesetVersion: s.doc.scan.rulesetVersion,
    findings: await store.findingsOf(s.id),
  });

  // Shared scan logic: analyze a local directory, persist, return the summary.
  const scanDirectory = async (org: OrgRecord, dir: string, opts: { commitSha?: string; repoRef?: string } = {}) => {
    const ctx = await buildScanContext(dir);
    const gateway = new LlmGateway({
      enabled: org.llmEnabled,
      apiKey: options.llmTransport ? "configured" : undefined,
      model: options.llmModel,
      transport: options.llmTransport,
    });
    const doc = await runScanAsync(
      ctx,
      {
        scanId: randomUUID(),
        rulesetVersion: RULESET_VERSION,
        executionMode: "hosted",
        semanticEnabled: org.llmEnabled,
        commitSha: opts.commitSha,
      },
      gateway,
    );
    await store.putScan({
      id: doc.scan.id,
      orgId: org.id,
      doc,
      disputes: new Map(),
      createdAt: new Date().toISOString(),
    });
    if (store.putRepo) await store.putRepo(org.id, opts.repoRef ?? dir, doc.scan.id);
    const visible = await store.findingsOf(doc.scan.id);
    return {
      scanId: doc.scan.id,
      frameworks: detectFrameworks(ctx),
      verified: visible.filter((f) => f.tier === "verified").length,
      research: visible.filter((f) => f.tier === "research").length,
    };
  };

  return {
    async createScan(orgId: string, repoPath: string) {
      const org = await requireOrg(orgId);
      return scanDirectory(org, repoPath, { repoRef: repoPath });
    },

    /** Scan history for the dashboard overview: per-scan finding summaries, oldest first. */
    async listScans(orgId: string) {
      await requireOrg(orgId);
      if (!store.listScans) return [];
      const repos = store.getRepos ? await store.getRepos(orgId) : [];
      const scans = await store.listScans(orgId);
      return Promise.all(
        scans.map(async (s) => {
          const findings = await store.findingsOf(s.id);
          const bySeverity: Record<string, number> = {};
          for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
          return {
            id: s.id,
            createdAt: s.createdAt,
            repo: repos.find((r) => r.lastScanId === s.id)?.name,
            verified: findings.filter((f) => f.tier === "verified").length,
            research: findings.filter((f) => f.tier === "research").length,
            bySeverity,
          };
        }),
      );
    },

    /**
     * Clone-and-scan a real GitHub repo (Â§clone). Fetches the repo tarball into a temp
     * workspace via the configured RepoFetcher, scans it, and always cleans up the workspace
     * (customer code is never retained beyond the scan â€” FR-026).
     */
    async scanRemoteRepo(orgId: string, repo: string, ref = "HEAD") {
      const org = await requireOrg(orgId);
      if (!options.repoFetcher) throw new Error("no repo fetcher configured (set options.repoFetcher)");
      const ws = await options.repoFetcher.fetch(repo, ref);
      try {
        const result = await scanDirectory(org, ws.dir, { commitSha: ws.sha, repoRef: repo });
        return { ...result, repo, ref, sha: ws.sha };
      } finally {
        await ws.cleanup();
      }
    },

    /**
     * GitHub webhook receiver (T072). Verifies the HMAC signature, and on a PR/push event
     * clone-and-scans the repo. For pull requests, it delivers the findings as a PR review
     * plus a CI-gate Check Run through the audited writer (suggest-and-approve; never a code
     * write â€” Principle III). Returns quickly with a summary.
     */
    async handleWebhook(rawBody: string, headers: WebhookHeaders) {
      if (!options.webhookSecret) throw new Error("no webhook secret configured");
      const event = verifyAndParseWebhook(headers, rawBody, options.webhookSecret);
      if (!shouldScan(event)) return { ok: true, scanned: false, event: event.type };

      const orgId = options.webhookOrgId ?? "demo";
      const org = await requireOrg(orgId);
      if (!options.repoFetcher) throw new Error("no repo fetcher configured");

      const repo = event.type === "pull_request" || event.type === "push" ? event.repo : "";
      const ref = event.type === "pull_request" ? event.sha : event.type === "push" ? event.sha || event.ref : "HEAD";

      // Capture the repo's prior scan (baseline) BEFORE this scan overwrites it, so we can
      // report only the findings this change INTRODUCED (incremental / fair gate â€” T035).
      let baselineFindings: Finding[] | undefined;
      if (store.getRepos) {
        const priorScanId = (await store.getRepos(orgId)).find((r) => r.name === repo)?.lastScanId;
        if (priorScanId) baselineFindings = await store.findingsOf(priorScanId);
      }

      const ws = await options.repoFetcher.fetch(repo, ref);
      try {
        const summary = await scanDirectory(org, ws.dir, { commitSha: ws.sha, repoRef: repo });
        const headFindings = await store.findingsOf(summary.scanId);

        // Incremental: gate/review only on findings introduced by this change.
        const diff = baselineFindings ? diffFindings(baselineFindings, headFindings) : undefined;
        const reportFindings = diff ? diff.added : headFindings;

        // PR: deliver review + gate check run through the audited writer (if a client is wired).
        if (event.type === "pull_request" && options.githubClient) {
          const writer = new AuditedWriter(new InMemoryAuditSink(), "gatepass-webhook");
          const remediator = new Remediator(options.githubClient, writer);
          await remediator.deliverReview(orgId, repo, event.prNumber, reportFindings);
          await remediator.publishGate(
            orgId,
            repo,
            event.sha,
            { mode: "block_verified", failureMode: "fail_open" },
            reportFindings,
            true,
          );
        }
        return {
          ok: true,
          scanned: true,
          event: event.type,
          repo,
          ...summary,
          incremental: !!diff,
          added: diff ? diff.added.length : undefined,
          fixed: diff ? diff.removed.length : undefined,
        };
      } finally {
        await ws.cleanup();
      }
    },

    // --- GitHub OAuth sign-in + sessions (FR-027, T076) ---

    /** Begin OAuth: the URL to send the user to. */
    authLoginUrl(state: string) {
      if (!options.oauthConfig) throw new Error("OAuth not configured");
      return { url: authorizeUrl(options.oauthConfig, state) };
    },

    /** OAuth callback: exchange the code, issue a signed session token. */
    async authCallback(code: string, orgId?: string) {
      if (!options.oauthConfig || !options.sessionSecret) throw new Error("OAuth/session not configured");
      const user = await exchangeCodeForUser(code, options.oauthConfig, options.oauthFetch);
      const org = orgId ?? options.webhookOrgId ?? "demo";
      // MVP role: default member; production maps the user's GitHub repo permission (roleFromGitHubPermission).
      const role: Role = "member";
      const token = createSession(
        { userId: String(user.githubUserId), login: user.login, orgId: org, role },
        options.sessionSecret,
      );
      return { token, user: { id: user.githubUserId, login: user.login }, orgId: org, role };
    },

    /** Verify a session token (for the /auth/me route and RBAC guards). */
    verifySessionToken(token: string | undefined): Session | null {
      if (!options.sessionSecret) return null;
      return verifySession(token, options.sessionSecret);
    },

    async getFindings(scanId: string, includeSuppressed = false): Promise<Finding[]> {
      await requireScan(scanId);
      return store.findingsOf(scanId, includeSuppressed);
    },

    async getSarif(scanId: string) {
      const scan = await requireScan(scanId);
      return toSarif(scan.doc);
    },

    // Dispute -> suppress this fingerprint org-wide so it does not recur on unchanged code (FR-011, T087).
    // Route: POST /v1/findings/:fingerprint/dispute { scanId, reason }
    async disputeFinding(fingerprint: string, scanId: string, reason: string) {
      const scan = await requireScan(scanId);
      if (!scan.doc.findings.some((f) => f.fingerprint === fingerprint))
        throw new NotFoundError(`finding ${fingerprint}`);
      scan.disputes.set(fingerprint, reason);
      await store.suppress(scan.orgId, fingerprint);
      return { ok: true, suppressed: fingerprint };
    },

    // Opt-in agent-loop fix guidance (FR-014, T079): 403 unless the org enabled it.
    async agentGuidance(orgId: string, scanId: string, fingerprint: string) {
      const org = await requireOrg(orgId);
      if (!org.agentLoopEnabled) throw new ForbiddenError("agent-loop integration is not enabled for this org");
      const scan = await requireScan(scanId);
      const finding = scan.doc.findings.find((f) => f.fingerprint === fingerprint);
      if (!finding) throw new NotFoundError(`finding ${fingerprint}`);
      const fix = generateSuggestedFix(finding);
      return {
        fingerprint,
        guidance: fix ?? { kind: "agent_guidance", content: "No automated guidance; review manually." },
      };
    },

    async evaluateGate(scanId: string, config: GateConfig) {
      const scan = await requireScan(scanId);
      return evaluateGate(config, { findings: await store.findingsOf(scan.id), scanCompleted: true });
    },

    async getEvidence(orgId: string, scanId: string) {
      const org = await requireOrg(orgId);
      requireFeature(org.planTier as PlanTier, "evidence_export");
      const scan = await requireScan(scanId);
      return evaluatePosture(await asPostureScan(scan));
    },

    // Push posture evidence to Vanta/Drata (FR-021, T083). Scale-tier gated; needs a token.
    async exportEvidence(orgId: string, scanId: string, platform: CompliancePlatform) {
      const org = await requireOrg(orgId);
      requireFeature(org.planTier as PlanTier, "evidence_export");
      const token = platform === "vanta" ? options.vantaToken : options.drataToken;
      if (!token) throw new ForbiddenError(`no ${platform} API token configured`);
      const scan = await requireScan(scanId);
      const items = evaluatePosture(await asPostureScan(scan));
      return new ApiEvidenceExporter(platform, token).export(items);
    },

    async draftQuestionnaire(orgId: string, scanId: string, format: SourceFormat, content: string) {
      const org = await requireOrg(orgId);
      requireFeature(org.planTier as PlanTier, "questionnaire_autofill");
      const scan = await requireScan(scanId);
      const questions = ingest(format, content);
      return draftAnswers(questions, await asPostureScan(scan));
    },

    // Fleet (FR-024, T085) â€” Scale tier.
    async registerFleetServer(
      orgId: string,
      name: string,
      endpointOrRepo: string,
      configHash: string,
    ): Promise<FleetServer> {
      const org = await requireOrg(orgId);
      requireFeature(org.planTier as PlanTier, "mcp_fleet");
      const server: FleetServer = { id: randomUUID(), orgId, name, endpointOrRepo, configHash, posture: "unscanned" };
      if (store.upsertFleetServer) {
        await store.upsertFleetServer(server);
      }
      return server;
    },

    async scanFleetServer(serverId: string, repoPath: string) {
      const server = await (store.getFleetServer ? store.getFleetServer(serverId) : Promise.resolve(undefined));
      if (!server) throw new NotFoundError(`fleet server ${serverId}`);
      const ctx = await buildScanContext(repoPath);
      const doc = runScan(ctx, {
        scanId: randomUUID(),
        rulesetVersion: RULESET_VERSION,
        executionMode: "hosted",
        semanticEnabled: true,
      });
      await store.putScan({
        id: doc.scan.id,
        orgId: server.orgId,
        doc,
        disputes: new Map(),
        createdAt: new Date().toISOString(),
      });
      server.lastScanId = doc.scan.id;
      server.posture = posture(doc.findings);
      return server;
    },

    // Config change -> rescan trigger (FR-024): only rescan if the config hash actually changed.
    async fleetConfigChanged(serverId: string, newHash: string): Promise<boolean> {
      const server = await (store.getFleetServer ? store.getFleetServer(serverId) : Promise.resolve(undefined));
      if (!server) throw new NotFoundError(`fleet server ${serverId}`);
      if (server.configHash === newHash) return false;
      server.configHash = newHash;
      server.posture = "unscanned";
      return true;
    },

    async fleetView(orgId: string) {
      await requireOrg(orgId);
      if (store.fleetView) {
        return store.fleetView(orgId);
      }
      return { servers: [], rollup: {} };
    },

    // Self-hosted runner results upload (FR-006a, T094): validate findings-only, then store.
    async ingestRunnerResults(orgId: string, payload: unknown) {
      await requireOrg(orgId);
      validateRunnerUpload(payload);
      const doc = parseFindingsDocument(payload);
      await store.putScan({ id: doc.scan.id, orgId, doc, disputes: new Map(), createdAt: new Date().toISOString() });
      return { scanId: doc.scan.id, findings: doc.findings.length };
    },

    async publishBenchmark(tool: string, corpusVersion: string, labels: CorpusCaseLabel[], detections: Detection[]) {
      const scored = scoreTool(tool, corpusVersion, labels, detections);
      if (!store.publishBenchmark) throw new Error("Store does not support benchmark publishing");
      await store.publishBenchmark(corpusVersion, tool, JSON.stringify(scored));
      return store.getBenchmark!(corpusVersion);
    },

    async getPublicBenchmark(corpusVersion?: string) {
      if (!store.getBenchmark) throw new Error("Store does not support benchmark retrieval");
      const rec = await store.getBenchmark(corpusVersion);
      if (!rec) {
        if (corpusVersion) throw new NotFoundError(`benchmark ${corpusVersion}`);
        return [];
      }
      return rec;
    },

    // POST /v1/orgs/:org/compliance/scan { repoPath }
    async complianceScan(orgId: string, repoPath: string) {
      // Called for the 404-on-unknown-org side effect; the record itself is unused here.
      await requireOrg(orgId);
      const ctx = await buildScanContext(repoPath);
      const scanId = `cmp-${randomUUID()}`;
      const result = runComplianceScan(ctx, scanId);
      if (store.putComplianceScan) {
        await store.putComplianceScan(scanId, orgId, result);
      }
      return result;
    },

    // GET /v1/orgs/:org/compliance/results/:scanId
    async complianceResult(orgId: string, scanId: string) {
      await requireOrg(orgId);
      if (!store.getComplianceScan) throw new Error("Store does not support compliance scan retrieval");
      const result = await store.getComplianceScan(scanId);
      if (!result) throw new NotFoundError(`compliance scan ${scanId}`);
      return result;
    },

    // GET /v1/orgs/:org
    async getOrg(orgId: string) {
      const org = await requireOrg(orgId);
      return org;
    },

    /**
     * PATCH /v1/orgs/:org/settings { llm_analysis_enabled?, agent_loop_enabled? }
     *
     * Org-scoped analysis toggles. Only these two fields are writable: plan tier
     * is set by billing, and the org id is its identity. Unknown keys are ignored
     * rather than merged, so a malformed body can never widen what is persisted.
     * Returns the full updated record so the caller reconciles against the
     * server's state instead of trusting its own optimistic copy.
     */
    async updateOrgSettings(orgId: string, patch: Record<string, unknown>) {
      const org = await requireOrg(orgId);
      const next: OrgRecord = {
        ...org,
        llmEnabled: typeof patch.llm_analysis_enabled === "boolean" ? patch.llm_analysis_enabled : org.llmEnabled,
        agentLoopEnabled:
          typeof patch.agent_loop_enabled === "boolean" ? patch.agent_loop_enabled : org.agentLoopEnabled,
      };
      return store.upsertOrg(next);
    },

    // GET /v1/orgs/:org/repos
    async listRepos(orgId: string) {
      await requireOrg(orgId);
      if (store.getRepos) {
        const tracked = await store.getRepos(orgId);
        return tracked.map((r) => ({
          name: r.name,
          visibility: "private",
          scanStatus: r.lastScanId ? "complete" : "never_scanned",
          gateMode: "off",
          gateFailureMode: "fail_open",
          frameworks: [] as string[],
          lastScanId: r.lastScanId,
        }));
      }
      return [];
    },
  };
}

function posture(findings: Finding[]): FleetServer["posture"] {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.length > 0) return "findings_open";
  return "passing";
}

/** Stable config-hash helper for callers/tests. */
export function hashConfig(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
