import type { FindingsDocument, Finding } from "@gatepass/findings";
import type { AccessGrant } from "@gatepass/github";
import type { PlanTier, Role } from "@gatepass/shared";

/**
 * In-memory store used by the API handlers. Production swaps this for the Postgres-backed
 * repositories (packages/shared/db) with identical shapes; the handlers depend only on this
 * interface, so the swap does not touch handler logic.
 */

export interface OrgRecord {
  id: string;
  planTier: PlanTier;
  llmEnabled: boolean;
  agentLoopEnabled: boolean;
  /**
   * The GitHub organization this tenant is, when it was created by a Gatepass App installation
   * rather than by hand.
   *
   * Present ⇒ membership of that GitHub org is what admits people here and what decides which
   * repositories each of them sees; there is no separate invite list, and removing somebody on
   * GitHub removes them here. Absent ⇒ a hand-made tenant (the `demo` org, a local install)
   * whose access comes from `GATEPASS_ALLOWED_LOGINS` instead.
   */
  githubOrgLogin?: string;
  /** The App installation that provisioned this org, for support and for the fallback path. */
  installationId?: number;
  /**
   * Per-org opt-in for suggested-fix pull requests (Principle III, as amended). Optional and
   * absent-means-off: a repository write is the one capability that must never arrive by
   * default, so an org record written before this field existed does not silently gain it.
   */
  fixPrEnabled?: boolean;
}

export interface StoredScan {
  id: string;
  orgId: string;
  doc: FindingsDocument;
  disputes: Map<string, string>; // fingerprint -> reason
  /** ISO timestamp set at creation; used for dashboard chronology. */
  createdAt?: string;
}

export interface FleetServer {
  id: string;
  orgId: string;
  name: string;
  endpointOrRepo: string;
  configHash: string;
  lastScanId?: string;
  posture: "unscanned" | "passing" | "findings_open" | "critical";
}

export type GateMode = "off" | "block_verified" | "block_threshold";
export type GateFailureMode = "fail_open" | "fail_closed";
export type RepoSource = "github" | "local_path";

/**
 * A repository this org has connected.
 *
 * Every optional field here is optional because it is genuinely *unknowable* in some
 * legitimate deployment, not because filling it in was deferred. `visibility` is the clearest
 * case: it is set only when it was actually read back from GitHub, so a deployment with no
 * GitHub App leaves it absent and the dashboard renders nothing rather than guessing. A
 * security dashboard that prints "Private" beside a public repository has told the operator
 * something false about their exposure, which is the one mistake this product cannot make.
 * The same rule governs `frameworks` (written by a scan) and `defaultBranch`.
 */
export interface RepoRecord {
  orgId: string;
  /** `owner/name` for a GitHub repository; an absolute path for a local-path scan target. */
  name: string;
  source: RepoSource;
  /** GitHub's own value, present only when it was read from GitHub. Absent means unknown. */
  visibility?: "public" | "private";
  /** GitHub's numeric repository id, when the App could resolve it. */
  githubRepoId?: number;
  defaultBranch?: string;
  /** Frameworks the most recent scan detected. Empty means "no scan yet, or none found". */
  frameworks: string[];
  gateMode: GateMode;
  gateFailureMode: GateFailureMode;
  agentLoopEnabled: boolean;
  lastScanId?: string;
  lastScanAt?: string;
  connectedAt: string;
}

/**
 * One person's GitHub-derived access, cached.
 *
 * The `accessToken` is the user's own OAuth token and is what makes refreshing possible — see
 * the header of `access.ts` for why it is stored and what it can and cannot do. It is optional
 * because a record written by a path that never held one (a test, an import) is still a usable
 * grant; it just cannot be refreshed, and will be re-resolved at the user's next sign-in.
 */
export interface UserAccessRecord {
  /** GitHub's numeric user id, as a string — the same value a session carries as `userId`. */
  githubUserId: string;
  login: string;
  grant: AccessGrant;
  accessToken?: string;
  /** ISO timestamp of the last successful resolution. Staleness is measured from here. */
  refreshedAt: string;
}

/**
 * A record as it comes *back* from a store, where the grant is whatever was in a JSON column.
 *
 * The asymmetry with `UserAccessRecord` is deliberate. Postgres cannot type its own `jsonb`,
 * and pretending otherwise would let a malformed or hand-edited row flow into the access
 * checks as though it were a grant Gatepass had produced. So reads are `unknown` and the
 * validation happens once, in `AccessDirectory`, where a row that is not a grant resolves to
 * *no* grant — the fail-closed direction.
 */
export type StoredUserAccess = Omit<UserAccessRecord, "grant"> & { grant: unknown };

/**
 * A local password account as stored.
 *
 * `passwordHash` is scrypt (`packages/shared/src/password.ts`); the plaintext exists nowhere in
 * this system. Structurally identical to the `LocalUser` parsed out of the environment, which is
 * the point — the two sources are interchangeable at the point of use.
 */
export interface LocalAccount {
  login: string;
  passwordHash: string;
  role: Role;
}

/** The subset of a repo record a caller may change (contracts/api.md: PATCH /orgs/:org/repos/:repo). */
export interface RepoSettingsPatch {
  gateMode?: GateMode;
  gateFailureMode?: GateFailureMode;
  agentLoopEnabled?: boolean;
}

/** Everything `putRepo` can learn from a scan that is not already in the record. */
export interface RepoScanMeta {
  frameworks?: string[];
  source?: RepoSource;
  visibility?: "public" | "private";
  githubRepoId?: number;
  defaultBranch?: string;
}

/** Defaults for a newly connected repo: gate off, fail open (Constitution/CLAUDE.md rule 4). */
export function newRepoRecord(orgId: string, name: string, meta: RepoScanMeta = {}): RepoRecord {
  return {
    orgId,
    name,
    source: meta.source ?? (/^[\w.-]+\/[\w.-]+$/.test(name) ? "github" : "local_path"),
    ...(meta.visibility ? { visibility: meta.visibility } : {}),
    ...(meta.githubRepoId !== undefined ? { githubRepoId: meta.githubRepoId } : {}),
    ...(meta.defaultBranch ? { defaultBranch: meta.defaultBranch } : {}),
    frameworks: meta.frameworks ?? [],
    gateMode: "off",
    gateFailureMode: "fail_open",
    agentLoopEnabled: false,
    connectedAt: new Date().toISOString(),
  };
}

/**
 * Store interface: all data-access methods are async so they work equally well
 * with the in-memory MemoryStore and the Postgres-backed PgStore.
 */
export interface Store {
  upsertOrg(org: OrgRecord): Promise<OrgRecord>;
  getOrg(orgId: string): Promise<OrgRecord | undefined>;
  putScan(scan: StoredScan): Promise<void>;
  getScan(scanId: string): Promise<StoredScan | undefined>;
  findingsOf(scanId: string, includeSuppressed?: boolean): Promise<Finding[]>;
  suppress(orgId: string, fingerprint: string): Promise<void>;
  isSuppressed(orgId: string, fingerprint: string): Promise<boolean>;
  upsertFleetServer?(server: FleetServer): Promise<FleetServer>;
  getFleetServer?(serverId: string): Promise<FleetServer | undefined>;
  fleetView?(orgId: string): Promise<{ servers: FleetServer[]; rollup: Record<string, number> }>;
  /**
   * Record that a scan ran against a repo, connecting it first if it was not already
   * connected. Scanning something is an implicit connect — that is how every repo used to
   * appear, and keeping it means the local-path flow needs no setup.
   */
  putRepo?(orgId: string, repoPath: string, scanId: string, meta?: RepoScanMeta): Promise<void>;
  /** List connected repos for an org. */
  getRepos?(orgId: string): Promise<RepoRecord[]>;
  /** One connected repo, or undefined. */
  getRepo?(orgId: string, name: string): Promise<RepoRecord | undefined>;
  /** Connect a repo explicitly. Returns the stored record (existing one if already connected). */
  connectRepo?(repo: RepoRecord): Promise<RepoRecord>;
  /** Apply a per-repo settings patch. Returns the updated record, or undefined if unknown. */
  updateRepo?(orgId: string, name: string, patch: RepoSettingsPatch): Promise<RepoRecord | undefined>;
  /** Disconnect a repo. Returns whether it was connected. Scans are left untouched. */
  deleteRepo?(orgId: string, name: string): Promise<boolean>;
  /**
   * Withdraw one issued session token by its `jti`, until `expiresAt` (unix seconds).
   *
   * Bounded by the token's own expiry on purpose: past that the signature check refuses it
   * anyway, so keeping the row would grow the table forever to re-answer a question already
   * settled. Absent on a store ⇒ that deployment cannot revoke, and `handlers.sessionsEnabled`
   * reports it rather than pretending sign-out did something.
   */
  revokeSession?(jti: string, expiresAt: number): Promise<void>;
  isSessionRevoked?(jti: string): Promise<boolean>;
  /**
   * Cache one user's GitHub-derived access. Absent on a store ⇒ that deployment does not
   * derive access from GitHub, and `AccessDirectory.enabled` reports it rather than silently
   * behaving as though every user had an empty grant (which would lock everyone out).
   */
  putUserAccess?(record: UserAccessRecord): Promise<void>;
  getUserAccess?(githubUserId: string): Promise<StoredUserAccess | undefined>;
  /** Forget a grant **and the stored GitHub token with it**. Called on sign-out. */
  deleteUserAccess?(githubUserId: string): Promise<void>;
  /** Orgs provisioned from a GitHub App installation, for admin/support views. */
  listOrgsByGithubLogin?(logins: readonly string[]): Promise<OrgRecord[]>;
  /**
   * Local password accounts, by login (case-insensitive).
   *
   * Absent on a store ⇒ that deployment has nowhere to keep accounts and falls back to the ones
   * named in `GATEPASS_LOCAL_USERS`. Both sources are consulted at sign-in; see `passwordSignIn`
   * for which wins and why.
   */
  getLocalAccount?(login: string): Promise<LocalAccount | undefined>;
  listLocalAccounts?(): Promise<LocalAccount[]>;
  putLocalAccount?(account: LocalAccount): Promise<void>;
  deleteLocalAccount?(login: string): Promise<boolean>;
  getBenchmark?(corpusVersion?: string): Promise<unknown>;
  publishBenchmark?(corpusVersion: string, tool: string, results: string): Promise<void>;
  getLatestScan?(): Promise<{ id: string; orgId: string } | undefined>;
  /** All scans for an org, oldest first (dashboard overview). */
  listScans?(orgId: string): Promise<StoredScan[]>;
  /** Store a compliance scan result keyed by scanId. */
  putComplianceScan?(scanId: string, orgId: string, result: unknown): Promise<void>;
  /** Get a stored compliance scan result. */
  getComplianceScan?(scanId: string): Promise<unknown | undefined>;
}

export class MemoryStore implements Store {
  readonly orgs = new Map<string, OrgRecord>();
  readonly scans = new Map<string, StoredScan>();
  readonly fleetServers = new Map<string, FleetServer>();
  /** Published benchmark runs keyed by corpus version (public, immutable once set). */
  readonly benchmarks = new Map<string, unknown>();
  /** Compliance scan results keyed by scanId. */
  readonly complianceScans = new Map<string, unknown>();
  /** Connected repos keyed by orgId → map of repo-name → record. */
  readonly repos = new Map<string, Map<string, RepoRecord>>();
  /** Org-level fingerprints suppressed by an accepted dispute (FR-011). */
  private readonly suppressed = new Map<string, Set<string>>();
  /** Revoked session ids → the unix second past which the entry is pointless to keep. */
  private readonly revokedSessions = new Map<string, number>();
  /** GitHub-derived access grants keyed by GitHub user id. */
  private readonly userAccess = new Map<string, UserAccessRecord>();
  /** Local password accounts keyed by lower-cased login. */
  private readonly localAccounts = new Map<string, LocalAccount>();

  async upsertOrg(org: OrgRecord): Promise<OrgRecord> {
    this.orgs.set(org.id, org);
    return org;
  }

  async getOrg(orgId: string): Promise<OrgRecord | undefined> {
    return this.orgs.get(orgId);
  }

  async putScan(scan: StoredScan): Promise<void> {
    this.scans.set(scan.id, scan);
  }

  async listScans(orgId: string): Promise<StoredScan[]> {
    return [...this.scans.values()].filter((s) => s.orgId === orgId);
  }

  async getScan(scanId: string): Promise<StoredScan | undefined> {
    return this.scans.get(scanId);
  }

  async suppress(orgId: string, fingerprint: string): Promise<void> {
    let set = this.suppressed.get(orgId);
    if (!set) {
      set = new Set();
      this.suppressed.set(orgId, set);
    }
    set.add(fingerprint);
  }

  async isSuppressed(orgId: string, fingerprint: string): Promise<boolean> {
    return this.suppressed.get(orgId)?.has(fingerprint) ?? false;
  }

  async revokeSession(jti: string, expiresAt: number): Promise<void> {
    // Sweep on write rather than on a timer: revocations are rare, so this is the cheapest
    // place to keep the map from growing without adding a background task to reason about.
    const now = Math.floor(Date.now() / 1000);
    for (const [id, exp] of this.revokedSessions) if (exp <= now) this.revokedSessions.delete(id);
    this.revokedSessions.set(jti, expiresAt);
  }

  async putUserAccess(record: UserAccessRecord): Promise<void> {
    this.userAccess.set(record.githubUserId, record);
  }

  async getUserAccess(githubUserId: string): Promise<UserAccessRecord | undefined> {
    return this.userAccess.get(githubUserId);
  }

  async deleteUserAccess(githubUserId: string): Promise<void> {
    this.userAccess.delete(githubUserId);
  }

  async getLocalAccount(login: string): Promise<LocalAccount | undefined> {
    return this.localAccounts.get(login.trim().toLowerCase());
  }

  async listLocalAccounts(): Promise<LocalAccount[]> {
    return [...this.localAccounts.values()];
  }

  async putLocalAccount(account: LocalAccount): Promise<void> {
    // Keyed on the lower-cased login, so "Admin" and "admin" are one account rather than two
    // near-duplicates one of which somebody could create alongside the other.
    this.localAccounts.set(account.login.trim().toLowerCase(), account);
  }

  async deleteLocalAccount(login: string): Promise<boolean> {
    return this.localAccounts.delete(login.trim().toLowerCase());
  }

  async listOrgsByGithubLogin(logins: readonly string[]): Promise<OrgRecord[]> {
    const wanted = new Set(logins.map((l) => l.toLowerCase()));
    return [...this.orgs.values()].filter((o) => o.githubOrgLogin && wanted.has(o.githubOrgLogin.toLowerCase()));
  }

  async isSessionRevoked(jti: string): Promise<boolean> {
    const exp = this.revokedSessions.get(jti);
    if (exp === undefined) return false;
    // A swept-but-not-yet-deleted entry is still a revocation until its token expires.
    return exp > Math.floor(Date.now() / 1000);
  }

  async findingsOf(scanId: string, includeSuppressed = false): Promise<Finding[]> {
    const scan = this.scans.get(scanId);
    if (!scan) return [];
    if (includeSuppressed) return scan.doc.findings;
    const suppressed = this.suppressed.get(scan.orgId);
    if (!suppressed) return scan.doc.findings;
    return scan.doc.findings.filter((f) => !suppressed.has(f.fingerprint));
  }

  async upsertFleetServer(server: FleetServer): Promise<FleetServer> {
    this.fleetServers.set(server.id, server);
    return server;
  }

  async getFleetServer(serverId: string): Promise<FleetServer | undefined> {
    return this.fleetServers.get(serverId);
  }

  async fleetView(orgId: string): Promise<{ servers: FleetServer[]; rollup: Record<string, number> }> {
    const servers = [...this.fleetServers.values()].filter((s) => s.orgId === orgId);
    const rollup: Record<string, number> = {
      total: servers.length,
      unscanned: 0,
      passing: 0,
      findings_open: 0,
      critical: 0,
    };
    for (const s of servers) rollup[s.posture]!++;
    return { servers, rollup };
  }

  private orgRepos(orgId: string): Map<string, RepoRecord> {
    let m = this.repos.get(orgId);
    if (!m) {
      m = new Map();
      this.repos.set(orgId, m);
    }
    return m;
  }

  async putRepo(orgId: string, repoPath: string, scanId: string, meta: RepoScanMeta = {}): Promise<void> {
    const repos = this.orgRepos(orgId);
    const existing = repos.get(repoPath);
    // Per-repo settings survive a rescan: a scan may update what it observed, never what
    // an operator configured.
    const base = existing ?? newRepoRecord(orgId, repoPath, meta);
    repos.set(repoPath, {
      ...base,
      ...(meta.frameworks ? { frameworks: meta.frameworks } : {}),
      ...(meta.visibility ? { visibility: meta.visibility } : {}),
      ...(meta.githubRepoId !== undefined ? { githubRepoId: meta.githubRepoId } : {}),
      ...(meta.defaultBranch ? { defaultBranch: meta.defaultBranch } : {}),
      lastScanId: scanId,
      lastScanAt: new Date().toISOString(),
    });
  }

  async getRepos(orgId: string): Promise<RepoRecord[]> {
    return [...this.orgRepos(orgId).values()];
  }

  async getRepo(orgId: string, name: string): Promise<RepoRecord | undefined> {
    return this.orgRepos(orgId).get(name);
  }

  async connectRepo(repo: RepoRecord): Promise<RepoRecord> {
    const repos = this.orgRepos(repo.orgId);
    const existing = repos.get(repo.name);
    // Idempotent: connecting an already-connected repo must not reset its settings or
    // discard its scan history.
    if (existing) {
      const merged: RepoRecord = {
        ...existing,
        ...(repo.visibility ? { visibility: repo.visibility } : {}),
        ...(repo.githubRepoId !== undefined ? { githubRepoId: repo.githubRepoId } : {}),
        ...(repo.defaultBranch ? { defaultBranch: repo.defaultBranch } : {}),
      };
      repos.set(repo.name, merged);
      return merged;
    }
    repos.set(repo.name, repo);
    return repo;
  }

  async updateRepo(orgId: string, name: string, patch: RepoSettingsPatch): Promise<RepoRecord | undefined> {
    const repos = this.orgRepos(orgId);
    const existing = repos.get(name);
    if (!existing) return undefined;
    const next: RepoRecord = {
      ...existing,
      ...(patch.gateMode ? { gateMode: patch.gateMode } : {}),
      ...(patch.gateFailureMode ? { gateFailureMode: patch.gateFailureMode } : {}),
      ...(typeof patch.agentLoopEnabled === "boolean" ? { agentLoopEnabled: patch.agentLoopEnabled } : {}),
    };
    repos.set(name, next);
    return next;
  }

  async deleteRepo(orgId: string, name: string): Promise<boolean> {
    return this.orgRepos(orgId).delete(name);
  }

  async getBenchmark(corpusVersion?: string): Promise<unknown> {
    if (corpusVersion) {
      const rec = this.benchmarks.get(corpusVersion);
      return rec ?? null;
    }
    return [...this.benchmarks.values()];
  }

  async publishBenchmark(corpusVersion: string, _tool: string, results: string): Promise<void> {
    const parsed = JSON.parse(results);
    const existing = this.benchmarks.get(corpusVersion) as { runs: unknown[] } | undefined;
    if (existing) {
      existing.runs.push(parsed);
    } else {
      this.benchmarks.set(corpusVersion, {
        corpusVersion,
        publishedAt: new Date().toISOString(),
        runs: [parsed],
      });
    }
  }

  async putComplianceScan(scanId: string, orgId: string, result: unknown): Promise<void> {
    this.complianceScans.set(scanId, { scanId, orgId, result, createdAt: new Date().toISOString() });
  }

  async getComplianceScan(scanId: string): Promise<unknown | undefined> {
    return this.complianceScans.get(scanId);
  }
}
