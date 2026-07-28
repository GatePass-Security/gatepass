// Re-export canonical types from packages
export type { Finding, Tier, Surface, Location, Reproduction, FindingsDocument } from "@gatepass/findings";
import type { Finding, Severity } from "@gatepass/findings";
export type { Severity };
import type { PlanTier } from "@gatepass/shared";
export type { PlanTier };

/*
 * Dashboard wire shapes. Each mirrors what `apps/api` actually returns — the
 * cited file:line is the source of truth, and these declarations exist only so
 * the dashboard does not take a runtime dependency on server-only packages.
 */

/** `GET /v1/orgs/:org` — apps/api/src/store.ts:10 */
export interface OrgRecord {
  id: string;
  planTier: PlanTier;
  llmEnabled: boolean;
  agentLoopEnabled: boolean;
}

/** `GET /v1/orgs/:org/repos` — apps/api/src/handlers.ts:444 */
export interface RepoRecord {
  name: string;
  visibility: string;
  scanStatus: "never_scanned" | "scanning" | "complete" | "failed";
  gateMode: "off" | "block_verified" | "block_threshold";
  gateFailureMode: "fail_open" | "fail_closed";
  frameworks: string[];
  lastScanId?: string;
}

/** `POST /v1/orgs/:org/scans` — apps/api/src/handlers.ts:118 */
export interface ScanResult {
  scanId: string;
  frameworks: string[];
  verified: number;
  research: number;
}

/** `POST /v1/orgs/:org/scan-remote` — ScanResult plus clone provenance (handlers.ts:172). */
export interface RemoteScanResult extends ScanResult {
  repo: string;
  ref: string;
  sha: string;
}

/** `GET /v1/orgs/:org/scans` — apps/api/src/handlers.ts:147 */
export interface ScanSummary {
  id: string;
  createdAt?: string;
  repo?: string;
  verified: number;
  research: number;
  bySeverity: Partial<Record<Severity, number>>;
}

export type FleetPosture = "unscanned" | "passing" | "findings_open" | "critical";

/** apps/api/src/store.ts:26 */
export interface FleetServer {
  id: string;
  orgId: string;
  name: string;
  endpointOrRepo: string;
  configHash: string;
  lastScanId?: string;
  posture: FleetPosture;
}

export interface FleetRollup {
  total: number;
  unscanned: number;
  passing: number;
  findings_open: number;
  critical: number;
}

/** `GET /v1/orgs/:org/fleet` */
export interface FleetView {
  servers: FleetServer[];
  rollup: FleetRollup;
}

/** `GET /v1/orgs/:org/scans/:id/agent-guidance` — apps/api/src/handlers.ts:290 */
export interface AgentGuidance {
  fingerprint: string;
  guidance: {
    kind: string;
    content: string;
  };
}

/**
 * `GET /v1/orgs/:org/evidence` returns `evaluatePosture(scan)`, i.e. control
 * coverage — not a list of export jobs. Mirrors packages/evidence/src/controls.ts:71.
 */
export interface EvidenceExport {
  controlId: string;
  soc2: string;
  iso27001: string;
  status: "pass" | "fail";
  description: string;
  failingFingerprints: string[];
  scanId: string;
  rulesetVersion: string;
  controlMapVersion: string;
}

/** packages/evidence/src/exporters.ts:13 */
export type CompliancePlatform = "vanta" | "drata";

/** `POST /v1/orgs/:org/evidence/export` — packages/evidence/src/exporters.ts:15 */
export interface EvidenceExportResult {
  platform: CompliancePlatform;
  delivered: number;
  externalIds: string[];
}

/** `POST /v1/orgs/:org/questionnaires` returns DraftedAnswer[] — packages/evidence/src/questionnaire.ts:14 */
export interface DraftedAnswer {
  questionId: string;
  question: string;
  status: "answered" | "needs_human_input";
  answer?: string;
  citations: { controlId: string; scanId: string }[];
  reviewStatus: "draft";
}

export type QuestionnaireDraft = DraftedAnswer[];

/** `GET /v1/orgs/:org/compliance/results/:scanId` — apps/api/src/store.ts:181 wraps the result. */
export interface ComplianceScanRecord {
  scanId: string;
  orgId: string;
  result: unknown;
  createdAt: string;
}

/*
 * CI merge gate. Mirrors packages/github/src/checkrun.ts — `evaluateGate` is a
 * pure decision function, so the dashboard can ask "what would the gate do with
 * this scan under this policy?" without touching a pull request.
 */
export type GateMode = "off" | "block_verified" | "block_threshold";
export type GateFailureMode = "fail_open" | "fail_closed";
export type CheckConclusion = "success" | "failure" | "neutral";

/** packages/github/src/checkrun.ts:19 */
export interface GateConfig {
  mode: GateMode;
  failureMode: GateFailureMode;
  threshold?: { minSeverity: Severity; maxAllowed: number };
}

/** `POST /v1/scans/:id/gate` — packages/github/src/checkrun.ts:31 */
export interface GateResult {
  conclusion: CheckConclusion;
  summary: string;
  blocking: Finding[];
}

/** `GET /v1/auth/me` — packages/shared session payload. */
export interface SessionInfo {
  orgId: string;
  userId: string;
  role: string;
  [key: string]: unknown;
}

/** `GET /v1/` and `GET /healthz` — the API's own status response. */
export interface ApiStatus {
  status: string;
  service: string;
  version: string;
  /** Only present when the API has GATEPASS_WEB_URL configured. */
  webAppUrl?: string;
}

/** `GET /v1/public/benchmark` */
export interface BenchmarkData {
  corpusVersion: string;
  publishedAt: string;
  runs: Array<{
    tool: string;
    perClass: Array<{
      classId: string;
      tp: number;
      fp: number;
      fn: number;
      precision: number;
      recall: number;
    }>;
  }>;
}

/**
 * An HTTP-level failure from the Gatepass API.
 *
 * `message` is the API's own `error` string and is deliberately kept verbatim —
 * `lib/errors.ts` pattern-matches on it to produce something a person can act
 * on, which only works if it arrives unmodified. It should not be rendered
 * directly; call `explainError` instead.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Seconds until the limit resets, from a 429's `retryAfter`. */
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
