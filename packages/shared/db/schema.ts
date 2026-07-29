import {
  pgTable,
  text,
  timestamp,
  bigint,
  pgEnum,
  numeric,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// ── Enums ──────────────────────────────────────────────────────────────
export const planTierEnum = pgEnum("plan_tier", ["free", "team", "scale"]);
export const memberRoleEnum = pgEnum("member_role", ["admin", "member", "viewer"]);
export const gateModeEnum = pgEnum("gate_mode", ["off", "block_verified", "block_threshold"]);
export const gateFailureModeEnum = pgEnum("gate_failure_mode", ["fail_open", "fail_closed"]);
export const scanTriggerEnum = pgEnum("scan_trigger", ["push", "pr", "manual", "schedule", "fleet_change"]);
export const scanExecModeEnum = pgEnum("scan_exec_mode", ["hosted", "runner", "cli"]);
export const scanStatusEnum = pgEnum("scan_status", ["queued", "running", "completed", "failed", "timed_out"]);
export const findingTierEnum = pgEnum("finding_tier", ["verified", "research"]);
export const findingSeverityEnum = pgEnum("finding_severity", ["critical", "high", "medium", "low"]);
export const findingStatusEnum = pgEnum("finding_status", ["open", "fixed", "disputed", "suppressed"]);
export const classStatusEnum = pgEnum("class_status", ["research", "corpus_ready", "active", "demoted"]);
export const disputeResolutionEnum = pgEnum("dispute_resolution", ["pending", "accepted_fp", "rejected"]);
export const fleetPostureEnum = pgEnum("fleet_posture", ["unscanned", "passing", "findings_open", "critical"]);

// ── Tables ─────────────────────────────────────────────────────────────
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  planTier: planTierEnum("plan_tier").notNull().default("free"),
  llmAnalysisEnabled: boolean("llm_analysis_enabled").notNull().default(true),
  agentLoopEnabled: boolean("agent_loop_enabled").notNull().default(false),
  ssoConnectionId: text("sso_connection_id"),
  /**
   * The GitHub organization this tenant *is*, when it was provisioned by installing the
   * Gatepass App on that org.
   *
   * Unique because a GitHub org is one tenant: two Gatepass orgs claiming the same GitHub org
   * would each derive access from the same membership list while holding separate findings,
   * and a user signing in would land in whichever one was found first. That is a tenancy bug
   * with a data-leak shape, so the database refuses it rather than the application remembering
   * to.
   */
  githubOrgLogin: text("github_org_login").unique(),
  /** The App installation that provisioned this org. */
  githubInstallationId: bigint("github_installation_id", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  githubUserId: bigint("github_user_id", { mode: "number" }).notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("member"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.userId] }),
  }),
);

/**
 * Connected repositories.
 *
 * Four columns changed when connect/disconnect became real (migration 0002):
 *
 *  - `github_repo_id` is nullable now. It was `NOT NULL UNIQUE`, which made the table unable
 *    to hold the two things it most needs to hold: a repository connected on a deployment
 *    with no GitHub App (so the id was never fetched), and a local directory scanned on the
 *    API host (which has no GitHub identity at all). Postgres permits repeated NULLs under a
 *    unique constraint, so uniqueness still holds for every row that *does* have an id.
 *  - `visibility` is nullable **on purpose**, and NULL is the default. It is written only
 *    when GitHub actually told us. The API omits the field entirely when it is NULL so the
 *    dashboard renders nothing rather than printing "Private" beside a public repository.
 *  - `source` distinguishes an `owner/name` repository from a path on the API host — the
 *    same table holds both, and they are not the same kind of thing.
 *  - `last_scan_id` / `last_scan_at` move the scan pointer out of the in-memory-only map that
 *    used to be the sole record of it.
 */
export const repositories = pgTable(
  "repositories",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    githubRepoId: bigint("github_repo_id", { mode: "number" }).unique(),
    name: text("name").notNull(),
    source: text("source").notNull().default("github"),
    /** `"public"` / `"private"`, or NULL for "not known". Never guessed. */
    visibility: text("visibility"),
    defaultBranch: text("default_branch"),
    frameworksDetected: text("frameworks_detected").array().notNull().default([]),
    surfacesPresent: text("surfaces_present").array().notNull().default([]),
    gateMode: gateModeEnum("gate_mode").notNull().default("off"),
    gateFailureMode: gateFailureModeEnum("gate_failure_mode").notNull().default("fail_open"),
    agentLoopEnabled: boolean("agent_loop_enabled").notNull().default(false),
    lastScanId: text("last_scan_id"),
    lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // A repo name is unique within an org, not globally: two tenants may each connect the
    // same public repository, and neither should be able to see or clobber the other's row.
    orgName: uniqueIndex("repositories_org_name_idx").on(t.orgId, t.name),
  }),
);

export const scans = pgTable("scans", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  repositoryId: text("repository_id").references(() => repositories.id, { onDelete: "cascade" }),
  fleetServerId: text("fleet_server_id"),
  trigger: scanTriggerEnum("trigger").notNull(),
  executionMode: scanExecModeEnum("execution_mode").notNull(),
  rulesetVersion: text("ruleset_version").notNull(),
  commitSha: text("commit_sha"),
  prNumber: integer("pr_number"),
  status: scanStatusEnum("status").notNull().default("queued"),
  stageTimings: text("stage_timings").notNull().default("{}"),
  postureSnapshot: text("posture_snapshot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  seq: integer("seq").primaryKey().generatedByDefaultAsIdentity(),
  orgId: text("org_id").references(() => organizations.id, { onDelete: "set null" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  subject: text("subject").notNull().default("{}"),
});

export const findings = pgTable(
  "findings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scanId: text("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    tier: findingTierEnum("tier").notNull(),
    classId: text("class_id").notNull(),
    severity: findingSeverityEnum("severity").notNull(),
    locations: text("locations").notNull(), // jsonb stored as text for simplicity
    surfaces: text("surfaces").array().notNull(),
    reproduction: text("reproduction"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    explanation: text("explanation").notNull(),
    status: findingStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scanIdx: index("findings_scan_idx").on(t.scanId),
    fingerprintUniq: uniqueIndex("findings_fingerprint_idx").on(t.scanId, t.fingerprint),
  }),
);

export const suggestedFixes = pgTable("suggested_fixes", {
  id: text("id").primaryKey(),
  findingId: text("finding_id")
    .notNull()
    .references(() => findings.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  content: text("content").notNull(), // jsonb
  deliveredVia: text("delivered_via"),
});

export const disputes = pgTable("disputes", {
  id: text("id").primaryKey(),
  findingId: text("finding_id")
    .notNull()
    .references(() => findings.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  reason: text("reason"),
  resolution: disputeResolutionEnum("resolution").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vulnerabilityClasses = pgTable("vulnerability_classes", {
  id: text("id").primaryKey(),
  tierTarget: findingTierEnum("tier_target").notNull(),
  definition: text("definition").notNull(),
  taxonomyRefs: text("taxonomy_refs").notNull().default("[]"),
  status: classStatusEnum("status").notNull().default("research"),
  corpusCaseCount: integer("corpus_case_count").notNull().default(0),
});

export const rules = pgTable("rules", {
  id: text("id").primaryKey(),
  classId: text("class_id")
    .notNull()
    .references(() => vulnerabilityClasses.id),
  rulesetVersionIntroduced: text("ruleset_version_introduced").notNull(),
  defaultRuleset: boolean("default_ruleset").notNull().default(false),
  measuredTpRate: numeric("measured_tp_rate"),
  measuredFpRate: numeric("measured_fp_rate"),
  measuredAgainstCorpus: text("measured_against_corpus"),
});

export const benchmarkRuns = pgTable("benchmark_runs", {
  id: text("id").primaryKey(),
  corpusVersion: text("corpus_version").notNull(),
  tool: text("tool").notNull(),
  results: text("results").notNull(), // jsonb
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const fleetServers = pgTable("fleet_servers", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  endpointOrRepo: text("endpoint_or_repo").notNull(),
  lastScanId: text("last_scan_id").references(() => scans.id),
  posture: fleetPostureEnum("posture").notNull().default("unscanned"),
  configHash: text("config_hash"),
});

export const evidenceExports = pgTable("evidence_exports", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  scanId: text("scan_id")
    .notNull()
    .references(() => scans.id),
  platform: text("platform").notNull(),
  controlMapVersion: text("control_map_version").notNull(),
  items: text("items").notNull(), // jsonb
  status: text("status").notNull().default("pending"),
});

export const questionnaireDrafts = pgTable("questionnaire_drafts", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  sourceFormat: text("source_format").notNull(),
  answers: text("answers").notNull(), // jsonb
  reviewStatus: text("review_status").notNull().default("draft"),
});

export const runnerTokens = pgTable("runner_tokens", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  minRulesetVersion: text("min_ruleset_version").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ── Compliance Tables ──────────────────────────────────────────────
export const complianceDomainEnum = pgEnum("compliance_domain", [
  "wcag",
  "ccpa",
  "app_store",
  "google_play",
  "eu_ai_act",
]);
export const complianceSeverityEnum = pgEnum("compliance_severity", ["critical", "warning", "info"]);
export const complianceStatusEnum = pgEnum("compliance_status", ["pass", "fail", "not_applicable", "manual_review"]);
export const complianceFixKindEnum = pgEnum("compliance_fix_kind", [
  "diff",
  "file_create",
  "config_change",
  "code_change",
]);

/** Per-scan compliance posture result */
export const complianceScans = pgTable("compliance_scans", {
  id: text("id").primaryKey(),
  scanId: text("scan_id")
    .notNull()
    .references(() => scans.id, { onDelete: "cascade" }),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  score: integer("score").notNull(), // 0–100
  totalChecks: integer("total_checks").notNull(),
  passCount: integer("pass_count").notNull(),
  failCount: integer("fail_count").notNull(),
  byDomain: text("by_domain").notNull(), // jsonb — per-domain breakdown
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Individual compliance check result */
export const complianceChecks = pgTable("compliance_checks", {
  id: text("id").primaryKey(),
  complianceScanId: text("compliance_scan_id")
    .notNull()
    .references(() => complianceScans.id, { onDelete: "cascade" }),
  ruleId: text("rule_id").notNull(),
  domain: complianceDomainEnum("domain").notNull(),
  status: complianceStatusEnum("status").notNull(),
  severity: complianceSeverityEnum("severity").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  locations: text("locations"), // jsonb array
  fixKind: complianceFixKindEnum("fix_kind"),
  fixDescription: text("fix_description"),
  fixDiff: text("fix_diff"),
  fixFilePath: text("fix_file_path"),
  fixNewContent: text("fix_new_content"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Session tokens withdrawn before their own expiry.
 *
 * Sessions are stateless HMAC tokens, which means the only thing that ever ended one was time.
 * Signing out cleared the browser's cookie and nothing more, so a token copied off the wire or
 * left on a shared machine kept working for the rest of its seven days with no way to cut it
 * off. This table is what makes "sign out" mean it.
 *
 * Rows are disposable: past `expires_at` the signature check refuses the token anyway, so
 * keeping the row only re-answers a settled question. Prune with
 * `delete from revoked_sessions where expires_at < now()`.
 */
export const revokedSessions = pgTable("revoked_sessions", {
  /** The token's `jti` claim. */
  jti: text("jti").primaryKey(),
  /** The token's own expiry — after this the row is safe to delete. */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One user's GitHub-derived access, cached between sign-ins.
 *
 * This table is a *cache*, not a grant. Nothing here confers access — every row is a recording
 * of what GitHub said, and it is re-derived on a short TTL. Deleting the table logs everyone
 * out of their repositories until they next sign in, and does not widen anybody's access by a
 * single repository. That is the property to preserve if this schema is ever changed: the day
 * an operator can edit a row here to grant somebody a repository, the whole model is gone.
 *
 * `access_token` is the user's own OAuth token (`read:user read:org`, no `repo` scope) and is
 * what makes refreshing possible. It is deleted on sign-out. Encrypt the column at the database
 * layer if your threat model calls for it — see apps/api/src/access.ts for the full reasoning.
 */
export const userAccessGrants = pgTable("user_access_grants", {
  /** GitHub's numeric user id, as text — the same value a session carries as `userId`. */
  githubUserId: text("github_user_id").primaryKey(),
  login: text("login").notNull(),
  /** The resolved `AccessGrant` (orgs, per-repo permissions, granularity). */
  grant: jsonb("grant").notNull(),
  accessToken: text("access_token"),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
});
