// Re-export canonical types from packages
export type { Finding, Tier, Surface, Location, Reproduction, FindingsDocument } from "@gatepass/findings";
/*
 * The suggested-fix vocabulary comes from the same schema the API validates
 * against (`packages/findings/src/schema.ts`), so it is re-exported rather than
 * restated here. That matters more than usual: the schema enforces
 * `kind === "diff"` ⇔ `edit` present, and a hand-copied declaration would let
 * the dashboard render a "diff" with no edit — a state the server cannot emit.
 * `Finding["suggestedFix"]` is already this type, so nothing else needs wiring.
 */
export type { FixOperation, FixEdit, SuggestedFix } from "@gatepass/findings";
import type { Finding, Severity, SuggestedFix } from "@gatepass/findings";
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
  /**
   * Opt-in for `POST /v1/orgs/:org/scans/:id/fix-pr`. Optional because older org
   * records predate the column — absent means off, which is the only safe
   * default for a flag that permits a write to a customer repository.
   */
  fixPrEnabled?: boolean;
}

/**
 * `GET /v1/orgs/:org/repos` — a connected repository (`handlers.ts`, `toRepoView`).
 *
 * `visibility` is **optional and never defaulted**. The API omits it entirely unless GitHub
 * actually reported it, so `undefined` here means "not known" and the UI must render nothing
 * rather than a guess. It used to be a required `string` that the API filled with the literal
 * `"private"` for every row — a security dashboard printing "Private" beside a public
 * repository states something false about exposure, which is the one mistake this product
 * cannot make.
 */
export interface RepoRecord {
  name: string;
  /** `github` for an `owner/name` repository; `local_path` for a directory on the API host. */
  source: "github" | "local_path";
  visibility?: "public" | "private";
  defaultBranch?: string;
  scanStatus: "never_scanned" | "scanning" | "complete" | "failed";
  gateMode: GateMode;
  gateFailureMode: GateFailureMode;
  agentLoopEnabled: boolean;
  frameworks: string[];
  lastScanId?: string;
  lastScanAt?: string;
  connectedAt: string;
}

/** Body of `PATCH /v1/orgs/:org/repos/:repo`. */
export interface RepoSettingsPatch {
  gate_mode?: GateMode;
  gate_failure_mode?: GateFailureMode;
  agent_loop_enabled?: boolean;
}

/**
 * `GET /v1/orgs/:org/repos/available` — repositories the Gatepass App installation can read
 * and this org has not connected. `configured: false` means the deployment has no GitHub App;
 * that is the ordinary case, not a failure.
 *
 * `visibility` is optional here for the same reason it is optional on `RepoRecord`: the
 * installation listing reports what GitHub said, and a payload that carried neither `private`
 * nor `visibility` omits the key rather than guessing. Rendering must therefore tolerate its
 * absence instead of assuming every entry in this list has one.
 */
export interface AvailableRepos {
  configured: boolean;
  repos: Array<{ githubRepoId: number; name: string; visibility?: "public" | "private"; defaultBranch?: string }>;
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
  /** The commit the scan actually read, when the repo was fetched rather than read from disk. */
  commitSha?: string;
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

/**
 * `GET /v1/orgs/:org/scans/:id/agent-guidance` — apps/api/src/handlers.ts:334.
 *
 * `guidance` is the finding's whole `SuggestedFix`, so it can carry an `edit`;
 * it is not a `{ kind, content }` pair. `classId` names the finding without a
 * second round trip.
 */
export interface AgentGuidance {
  fingerprint: string;
  classId: string;
  guidance: SuggestedFix;
}

/** One fix that was deliberately not committed — packages/github/src/fix-pr.ts:133. */
export interface SkippedFix {
  fingerprint: string;
  classId: string;
  path: string;
  reason: string;
}

/**
 * `POST /v1/orgs/:org/scans/:id/fix-pr` — packages/github/src/fix-pr.ts:140.
 *
 * Declared here rather than imported: `@gatepass/github` holds App credentials
 * and is server-only, and the dashboard must not take a runtime dependency on it.
 */
export interface FixPullRequestResult {
  number: number;
  url: string;
  branch: string;
  base: string;
  /** Paths actually written, in the order committed. */
  files: string[];
  /** Fingerprints whose fix landed in the branch. */
  applied: string[];
  skipped: SkippedFix[];
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

/** `GET /v1/auth/me` — the session payload plus the orgs this account currently reaches. */
export interface SessionInfo {
  orgId: string;
  userId: string;
  login: string;
  role: Role;
  /** Unix seconds. */
  exp: number;
  /**
   * Every org the signed-in GitHub account can reach, resolved live rather than read from the
   * token — so an org somebody joined this morning appears without a fresh sign-in, and one
   * they were removed from disappears. Absent on a deployment that does not derive access from
   * GitHub.
   */
  orgs?: OrgMembershipSummary[];
  [key: string]: unknown;
}

/** Org roles, mirroring `packages/shared/src/roles.ts`. */
export type Role = "admin" | "member" | "viewer";

/**
 * `GET /v1/auth/config` — which sign-in doors this deployment has.
 *
 * `devAuth` is deployment configuration, not a secret: it is false in production by
 * construction (`apps/api/src/auth.ts`), so publishing it tells nobody anything they could
 * act on. The login page needs it to render the truth about this machine.
 */
export interface AuthConfig {
  github: boolean;
  devAuth: boolean;
  /**
   * Whether this deployment has local password accounts. A door for people who should be able
   * to look at Gatepass without authorizing an OAuth app against their personal GitHub account
   * first — reviewers, auditors, anyone being shown the product.
   */
  password?: boolean;
  orgId: string;
}

/** `POST /v1/auth/github/callback` and `POST /v1/auth/dev-session`. */
/**
 * One organization the signed-in account can reach.
 *
 * `accessGranularity` says how the repository list behind it was established, and is worth
 * surfacing rather than hiding: `"installation"` and `"collaborator"` mean this person sees
 * exactly the repositories GitHub grants them, while `"org-membership"` means the deployment
 * could only establish that they are in the org and is showing them all of its repositories.
 * Those are different claims about who can see what, and an admin should be able to tell which
 * one their deployment is making.
 */
export interface OrgMembershipSummary {
  id: string;
  role: Role;
  repoCount: number;
  /** False for an outside collaborator — someone with repository access but not in the org. */
  member?: boolean;
  accessGranularity?: "installation" | "collaborator" | "org-membership";
}

export interface AuthResult {
  token: string;
  user: { id: number; login: string };
  orgId: string;
  role: Role;
  /** Every org this account reaches. Empty on a deployment that does not derive access from GitHub. */
  orgs?: OrgMembershipSummary[];
  /** Present and true only for a development session. */
  development?: boolean;
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
