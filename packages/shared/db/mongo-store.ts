import type { Finding, FindingsDocument } from "@gatepass/findings";
import type { PlanTier } from "../src/plan-tier.js";

/**
 * MongoDB-backed store.
 *
 * ## Why the whole store, and not just accounts
 *
 * Before this, a deployment with no `DATABASE_URL` ran on `MemoryStore` — every org, scan,
 * finding, revoked session and access grant lost on restart. Putting *only* passwords in a
 * database while everything else evaporated would have solved the smaller half of the problem
 * and left the confusing half: a login that survives a restart into an instance with no data.
 *
 * ## The shape fits
 *
 * The `Store` interface is already document-oriented. A scan *is* a `FindingsDocument` plus a
 * little metadata; the Postgres implementation has to shred that into `scans` + `findings` rows
 * and reassemble it on read. Here it is stored as it is used, and `findingsOf` is a projection
 * rather than a join. The one place that costs something is noted on `findingsOf` below.
 *
 * ## Injected, not imported
 *
 * The constructor takes a minimal `MongoLike` rather than the driver's `Db`, so the logic in
 * this file is exercised by tests against an in-memory fake. That is a deliberate limit on what
 * those tests prove: they cover the mapping, the filters and the upsert semantics — everything
 * this file decides — and they do not prove the driver behaves as documented. A live cluster is
 * the only thing that proves that, and `createMongoStore` is the seam where one is attached.
 */

/** The slice of a MongoDB collection this store uses. Kept small so a fake is honest. */
export interface CollectionLike<T = any> {
  findOne(filter: Record<string, any>): Promise<T | null>;
  find(filter: Record<string, any>): { toArray(): Promise<T[]> };
  updateOne(
    filter: Record<string, any>,
    update: Record<string, any>,
    options?: { upsert?: boolean },
  ): Promise<{ upsertedCount?: number; modifiedCount?: number; matchedCount?: number }>;
  deleteOne(filter: Record<string, any>): Promise<{ deletedCount?: number }>;
  createIndex(spec: Record<string, any>, options?: Record<string, any>): Promise<unknown>;
}

export interface MongoLike {
  collection<T = any>(name: string): CollectionLike<T>;
}

/** Collection names, in one place so a deployment can see exactly what this writes. */
export const COLLECTIONS = {
  orgs: "organizations",
  scans: "scans",
  suppressions: "suppressions",
  repos: "repositories",
  fleet: "fleet_servers",
  revokedSessions: "revoked_sessions",
  accessGrants: "user_access_grants",
  benchmarks: "benchmarks",
  complianceScans: "compliance_scans",
  accounts: "local_accounts",
} as const;

type Role = "admin" | "member" | "viewer";

interface OrgDoc {
  _id: string;
  planTier: PlanTier;
  llmEnabled: boolean;
  agentLoopEnabled: boolean;
  fixPrEnabled?: boolean;
  githubOrgLogin?: string;
  installationId?: number;
}

interface ScanDoc {
  _id: string;
  orgId: string;
  doc: FindingsDocument;
  /** `fingerprint → reason`, stored as an object because a Map is not BSON. */
  disputes: Record<string, string>;
  createdAt?: string;
}

/**
 * The repository shape the API's `Store` interface expects, restated here.
 *
 * Restated rather than imported because `packages/shared` must not depend on `apps/api` — the
 * dependency runs the other way. `PgStore` does the same thing by returning object literals;
 * naming it makes the contract this store is meeting visible instead of implicit.
 */
export interface RepoRecordShape {
  orgId: string;
  name: string;
  source: "github" | "local_path";
  visibility?: "public" | "private";
  githubRepoId?: number;
  defaultBranch?: string;
  frameworks: string[];
  gateMode: "off" | "block_verified" | "block_threshold";
  gateFailureMode: "fail_open" | "fail_closed";
  agentLoopEnabled: boolean;
  lastScanId?: string;
  lastScanAt?: string;
  connectedAt: string;
}

export interface FleetServerShape {
  id: string;
  orgId: string;
  name: string;
  endpointOrRepo: string;
  configHash: string;
  lastScanId?: string;
  posture: "unscanned" | "passing" | "findings_open" | "critical";
}

type RepoDoc = { _id: string } & RepoRecordShape;

/** A local password account. The hash is scrypt; the plaintext is nowhere. */
export interface LocalAccountDoc {
  _id: string;
  login: string;
  passwordHash: string;
  role: Role;
  updatedAt: string;
}

/**
 * The `_id` for anything scoped to one org: the org id and the record's name, joined.
 *
 * The separator is NUL because it is the one byte that cannot appear in either half. A repo
 * "name" is an `owner/name` slug for a GitHub repository but an absolute *path* for a local
 * scan target, and a path may legally contain a space, a colon or a slash — so any of the
 * obvious separators could let two different repositories collide on one key, which is a
 * silent overwrite of one org's record by another's.
 */
function key(...parts: string[]): string {
  return parts.join("\u0000");
}

export class MongoStore {
  constructor(private readonly db: MongoLike) {}

  /**
   * Indexes this store depends on. Idempotent, so it is safe to call on every boot.
   *
   * The TTL index on `revoked_sessions` is the one that earns its keep: the Postgres schema
   * needs a periodic `DELETE ... WHERE expires_at < now()` that nothing currently runs, and here
   * the database does it. A revocation is only meaningful until the token it names expires
   * anyway, so an unbounded collection would be storing answers to questions nobody can ask.
   */
  async ensureIndexes(): Promise<void> {
    await this.db.collection(COLLECTIONS.scans).createIndex({ orgId: 1, createdAt: -1 });
    await this.db.collection(COLLECTIONS.repos).createIndex({ orgId: 1 });
    await this.db.collection(COLLECTIONS.fleet).createIndex({ orgId: 1 });
    await this.db.collection(COLLECTIONS.suppressions).createIndex({ orgId: 1, fingerprint: 1 });
    await this.db.collection(COLLECTIONS.orgs).createIndex({ githubOrgLogin: 1 }, { sparse: true });
    await this.db.collection(COLLECTIONS.revokedSessions).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  // ── Organizations ─────────────────────────────────────────────────────────

  async upsertOrg(org: {
    id: string;
    planTier: PlanTier;
    llmEnabled: boolean;
    agentLoopEnabled: boolean;
    fixPrEnabled?: boolean;
    githubOrgLogin?: string;
    installationId?: number;
  }): Promise<typeof org> {
    /*
     * Only the fields actually supplied are written. An upsert from a path that does not know
     * the GitHub linkage — a settings PATCH, say — must not blank it out, because that would
     * quietly turn a GitHub-backed tenant into a hand-made one and cut off the membership
     * lookup that decides who may sign into it.
     */
    const set: Record<string, unknown> = {
      planTier: org.planTier,
      llmEnabled: org.llmEnabled,
      agentLoopEnabled: org.agentLoopEnabled,
    };
    if (org.fixPrEnabled !== undefined) set.fixPrEnabled = org.fixPrEnabled;
    if (org.githubOrgLogin) set.githubOrgLogin = org.githubOrgLogin;
    if (org.installationId !== undefined) set.installationId = org.installationId;

    await this.db.collection<OrgDoc>(COLLECTIONS.orgs).updateOne({ _id: org.id }, { $set: set }, { upsert: true });
    return org;
  }

  async getOrg(orgId: string) {
    const row = await this.db.collection<OrgDoc>(COLLECTIONS.orgs).findOne({ _id: orgId });
    return row ? toOrg(row) : undefined;
  }

  async listOrgsByGithubLogin(logins: readonly string[]) {
    if (logins.length === 0) return [];
    const rows = await this.db
      .collection<OrgDoc>(COLLECTIONS.orgs)
      .find({ githubOrgLogin: { $in: [...logins] } })
      .toArray();
    return rows.map(toOrg);
  }

  // ── Scans and findings ────────────────────────────────────────────────────

  async putScan(scan: {
    id: string;
    orgId: string;
    doc: FindingsDocument;
    disputes: Map<string, string>;
    createdAt?: string;
  }): Promise<void> {
    const doc: Omit<ScanDoc, "_id"> = {
      orgId: scan.orgId,
      doc: scan.doc,
      // A Map is not BSON. Round-tripped back to a Map on read.
      disputes: Object.fromEntries(scan.disputes),
      ...(scan.createdAt ? { createdAt: scan.createdAt } : {}),
    };
    await this.db.collection<ScanDoc>(COLLECTIONS.scans).updateOne({ _id: scan.id }, { $set: doc }, { upsert: true });
  }

  async getScan(scanId: string) {
    const row = await this.db.collection<ScanDoc>(COLLECTIONS.scans).findOne({ _id: scanId });
    return row ? toScan(row) : undefined;
  }

  async listScans(orgId: string) {
    const rows = await this.db.collection<ScanDoc>(COLLECTIONS.scans).find({ orgId }).toArray();
    // Oldest first, matching MemoryStore. Undated rows sort first rather than being dropped —
    // a scan written before `createdAt` existed is still a scan.
    return rows.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "")).map(toScan);
  }

  async getLatestScan() {
    const rows = await this.db.collection<ScanDoc>(COLLECTIONS.scans).find({}).toArray();
    const latest = rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
    return latest ? { id: latest._id, orgId: latest.orgId } : undefined;
  }

  /**
   * Findings for a scan, with org-wide suppressions applied.
   *
   * Two reads rather than one, because suppression is an org-level fact and the scan document
   * predates any dispute against it. Filtering in the application rather than in the query is
   * deliberate: the alternative is embedding suppressed fingerprints in every scan document and
   * rewriting all of them whenever somebody disputes a finding.
   */
  async findingsOf(scanId: string, includeSuppressed = false): Promise<Finding[]> {
    const scan = await this.db.collection<ScanDoc>(COLLECTIONS.scans).findOne({ _id: scanId });
    if (!scan) return [];
    const findings = scan.doc?.findings ?? [];
    if (includeSuppressed) return findings;
    const suppressed = await this.db
      .collection<{ fingerprint: string }>(COLLECTIONS.suppressions)
      .find({ orgId: scan.orgId })
      .toArray();
    if (suppressed.length === 0) return findings;
    const set = new Set(suppressed.map((s) => s.fingerprint));
    return findings.filter((f) => !set.has(f.fingerprint));
  }

  async suppress(orgId: string, fingerprint: string): Promise<void> {
    await this.db
      .collection(COLLECTIONS.suppressions)
      .updateOne({ _id: key(orgId, fingerprint) }, { $set: { orgId, fingerprint } }, { upsert: true });
  }

  async isSuppressed(orgId: string, fingerprint: string): Promise<boolean> {
    return (await this.db.collection(COLLECTIONS.suppressions).findOne({ _id: key(orgId, fingerprint) })) !== null;
  }

  // ── Repositories ──────────────────────────────────────────────────────────

  async getRepos(orgId: string): Promise<RepoRecordShape[]> {
    const rows = await this.db.collection<RepoDoc>(COLLECTIONS.repos).find({ orgId }).toArray();
    return rows.map(stripId);
  }

  async getRepo(orgId: string, name: string): Promise<RepoRecordShape | undefined> {
    const row = await this.db.collection<RepoDoc>(COLLECTIONS.repos).findOne({ _id: key(orgId, name) });
    return row ? stripId(row) : undefined;
  }

  async connectRepo(repo: RepoRecordShape): Promise<RepoRecordShape> {
    const existing = await this.getRepo(repo.orgId, repo.name);
    /*
     * Idempotent, and existing settings win. Connecting an already-connected repository must
     * not reset its gate policy or discard its scan history — only fill in metadata GitHub has
     * since told us about.
     */
    const merged: RepoRecordShape = existing
      ? {
          ...existing,
          // Only metadata GitHub may have told us since. Everything an operator configured, and
          // everything a scan observed, is read back off `existing` below.
          ...definedOnly({
            visibility: repo.visibility,
            githubRepoId: repo.githubRepoId,
            defaultBranch: repo.defaultBranch,
          }),
        }
      : repo;
    await this.db
      .collection<RepoDoc>(COLLECTIONS.repos)
      .updateOne({ _id: key(repo.orgId, repo.name) }, { $set: definedOnly(merged) }, { upsert: true });
    return (await this.getRepo(repo.orgId, repo.name))!;
  }

  async putRepo(orgId: string, name: string, scanId: string, meta: Record<string, any> = {}): Promise<void> {
    const existing = await this.getRepo(orgId, name);
    const base = existing ?? {
      orgId,
      name,
      source: /^[\w.-]+\/[\w.-]+$/.test(name) ? "github" : "local_path",
      frameworks: [],
      gateMode: "off",
      gateFailureMode: "fail_open",
      agentLoopEnabled: false,
      connectedAt: new Date().toISOString(),
    };
    // A scan may update what it *observed*; never what an operator configured.
    const next = {
      ...base,
      ...definedOnly({
        frameworks: meta.frameworks,
        source: meta.source,
        visibility: meta.visibility,
        githubRepoId: meta.githubRepoId,
        defaultBranch: meta.defaultBranch,
      }),
      lastScanId: scanId,
      lastScanAt: new Date().toISOString(),
    };
    await this.db
      .collection<RepoDoc>(COLLECTIONS.repos)
      .updateOne({ _id: key(orgId, name) }, { $set: next }, { upsert: true });
  }

  async updateRepo(orgId: string, name: string, patch: Record<string, any>): Promise<RepoRecordShape | undefined> {
    const existing = await this.getRepo(orgId, name);
    if (!existing) return undefined;
    const next = { ...existing, ...definedOnly(patch) } as RepoRecordShape;
    await this.db.collection<RepoDoc>(COLLECTIONS.repos).updateOne({ _id: key(orgId, name) }, { $set: next });
    return next;
  }

  async deleteRepo(orgId: string, name: string): Promise<boolean> {
    const res = await this.db.collection(COLLECTIONS.repos).deleteOne({ _id: key(orgId, name) });
    return (res.deletedCount ?? 0) > 0;
  }

  // ── Fleet ─────────────────────────────────────────────────────────────────

  async upsertFleetServer(server: FleetServerShape): Promise<FleetServerShape> {
    await this.db.collection(COLLECTIONS.fleet).updateOne({ _id: server.id }, { $set: server }, { upsert: true });
    return server;
  }

  async getFleetServer(serverId: string): Promise<FleetServerShape | undefined> {
    const row = await this.db
      .collection<{ _id: string } & FleetServerShape>(COLLECTIONS.fleet)
      .findOne({ _id: serverId });
    return row ? stripId(row) : undefined;
  }

  async fleetView(orgId: string): Promise<{ servers: FleetServerShape[]; rollup: Record<string, number> }> {
    const servers = (
      await this.db.collection<{ _id: string } & FleetServerShape>(COLLECTIONS.fleet).find({ orgId }).toArray()
    ).map(stripId);
    const rollup: Record<string, number> = {
      total: servers.length,
      unscanned: 0,
      passing: 0,
      findings_open: 0,
      critical: 0,
    };
    for (const s of servers) rollup[String(s.posture)] = (rollup[String(s.posture)] ?? 0) + 1;
    return { servers, rollup };
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  /**
   * Withdraw one issued session token until its own expiry.
   *
   * `expiresAt` is a real `Date` because the TTL index reads it — stored as a string, Mongo
   * would keep the row forever, and a revocation list that only grows is a revocation list
   * nobody prunes.
   */
  async revokeSession(jti: string, expiresAt: number): Promise<void> {
    await this.db
      .collection(COLLECTIONS.revokedSessions)
      .updateOne({ _id: jti }, { $set: { expiresAt: new Date(expiresAt * 1000) } }, { upsert: true });
  }

  async isSessionRevoked(jti: string): Promise<boolean> {
    const row = await this.db.collection<{ expiresAt: Date }>(COLLECTIONS.revokedSessions).findOne({ _id: jti });
    if (!row) return false;
    /*
     * The TTL monitor runs about once a minute, so a row can outlive its expiry by that much.
     * Checking here as well means a revocation never *under*-reports because of the sweep's
     * timing — and past the expiry the signature check refuses the token anyway.
     */
    return new Date(row.expiresAt).getTime() > Date.now();
  }

  // ── GitHub-derived access ─────────────────────────────────────────────────

  async putUserAccess(record: {
    githubUserId: string;
    login: string;
    grant: unknown;
    accessToken?: string;
    refreshedAt: string;
  }): Promise<void> {
    const set: Record<string, unknown> = { login: record.login, grant: record.grant, refreshedAt: record.refreshedAt };
    // Written only when supplied: a refresh has a new grant but no new token, and blanking it
    // would silently freeze that user's access until their next sign-in.
    if (record.accessToken) set.accessToken = record.accessToken;
    await this.db
      .collection(COLLECTIONS.accessGrants)
      .updateOne({ _id: record.githubUserId }, { $set: set }, { upsert: true });
  }

  async getUserAccess(githubUserId: string) {
    const row = await this.db.collection<Record<string, any>>(COLLECTIONS.accessGrants).findOne({ _id: githubUserId });
    if (!row) return undefined;
    return {
      githubUserId: row._id as string,
      login: row.login as string,
      grant: row.grant,
      ...(row.accessToken ? { accessToken: row.accessToken as string } : {}),
      refreshedAt: row.refreshedAt as string,
    };
  }

  async deleteUserAccess(githubUserId: string): Promise<void> {
    await this.db.collection(COLLECTIONS.accessGrants).deleteOne({ _id: githubUserId });
  }

  // ── Local password accounts ───────────────────────────────────────────────

  /**
   * Look up one local account, case-insensitively.
   *
   * The `_id` is the lower-cased login, which is what makes "Admin" and "admin" the same
   * account rather than two — and stops somebody creating a near-duplicate of an existing one.
   */
  async getLocalAccount(login: string) {
    const row = await this.db
      .collection<LocalAccountDoc>(COLLECTIONS.accounts)
      .findOne({ _id: login.trim().toLowerCase() });
    return row ? { login: row.login, passwordHash: row.passwordHash, role: row.role } : undefined;
  }

  async listLocalAccounts() {
    const rows = await this.db.collection<LocalAccountDoc>(COLLECTIONS.accounts).find({}).toArray();
    return rows.map((r) => ({ login: r.login, passwordHash: r.passwordHash, role: r.role }));
  }

  async putLocalAccount(account: { login: string; passwordHash: string; role: Role }): Promise<void> {
    await this.db.collection<LocalAccountDoc>(COLLECTIONS.accounts).updateOne(
      { _id: account.login.trim().toLowerCase() },
      {
        $set: {
          login: account.login,
          passwordHash: account.passwordHash,
          role: account.role,
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    );
  }

  async deleteLocalAccount(login: string): Promise<boolean> {
    const res = await this.db.collection(COLLECTIONS.accounts).deleteOne({ _id: login.trim().toLowerCase() });
    return (res.deletedCount ?? 0) > 0;
  }

  // ── Benchmark and compliance ──────────────────────────────────────────────

  async getBenchmark(corpusVersion?: string) {
    if (corpusVersion) {
      const row = await this.db.collection<Record<string, any>>(COLLECTIONS.benchmarks).findOne({ _id: corpusVersion });
      return row ? stripId(row) : null;
    }
    return (await this.db.collection<Record<string, any>>(COLLECTIONS.benchmarks).find({}).toArray()).map(stripId);
  }

  async publishBenchmark(corpusVersion: string, _tool: string, results: string): Promise<void> {
    const parsed = JSON.parse(results);
    const existing = await this.db
      .collection<Record<string, any>>(COLLECTIONS.benchmarks)
      .findOne({ _id: corpusVersion });
    const runs = Array.isArray(existing?.runs) ? [...existing!.runs, parsed] : [parsed];
    await this.db
      .collection(COLLECTIONS.benchmarks)
      .updateOne(
        { _id: corpusVersion },
        { $set: { corpusVersion, publishedAt: existing?.publishedAt ?? new Date().toISOString(), runs } },
        { upsert: true },
      );
  }

  async putComplianceScan(scanId: string, orgId: string, result: unknown): Promise<void> {
    await this.db
      .collection(COLLECTIONS.complianceScans)
      .updateOne(
        { _id: scanId },
        { $set: { scanId, orgId, result, createdAt: new Date().toISOString() } },
        { upsert: true },
      );
  }

  async getComplianceScan(scanId: string) {
    const row = await this.db.collection<Record<string, any>>(COLLECTIONS.complianceScans).findOne({ _id: scanId });
    return row ? stripId(row) : undefined;
  }
}

function toOrg(row: OrgDoc) {
  return {
    id: row._id,
    planTier: row.planTier,
    llmEnabled: row.llmEnabled,
    agentLoopEnabled: row.agentLoopEnabled,
    // Absent rather than false/null: every consumer already tests for undefined, and "we have
    // no record of this" is a different statement from "it is off".
    ...(row.fixPrEnabled !== undefined ? { fixPrEnabled: row.fixPrEnabled } : {}),
    ...(row.githubOrgLogin ? { githubOrgLogin: row.githubOrgLogin } : {}),
    ...(row.installationId !== undefined ? { installationId: row.installationId } : {}),
  };
}

function toScan(row: ScanDoc) {
  return {
    id: row._id,
    orgId: row.orgId,
    doc: row.doc,
    disputes: new Map(Object.entries(row.disputes ?? {})),
    ...(row.createdAt ? { createdAt: row.createdAt } : {}),
  };
}

/** Drop Mongo's `_id` — it is a storage detail and no consumer of `Store` knows about it. */
function stripId<T extends Record<string, any>>(row: T): Omit<T, "_id"> {
  const { _id: _drop, ...rest } = row;
  return rest;
}

/**
 * Strip `undefined` values.
 *
 * `$set: { visibility: undefined }` writes a null in some driver versions, which would record
 * "we asked GitHub and it is nothing" where the truth is "we do not know" — the exact
 * distinction the whole absent-means-unknown rule rests on.
 */
function definedOnly<T extends Record<string, any>>(obj: T): Record<string, any> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
