import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type { PlanTier } from "../src/plan-tier.js";
import { inArray } from "drizzle-orm";
import type { FindingsDocument, Finding, Location, SuggestedFix } from "@gatepass/findings";

/**
 * Postgres-backed store implementing the Store interface.
 * Apply migrations first: `pnpm db:migrate` (generated from db/schema.ts into db/drizzle).
 */

/**
 * A connected repository as this store reads and writes it.
 *
 * Structurally identical to `RepoRecord` in `apps/api/src/store.ts` and declared separately
 * because `@gatepass/shared` must not depend on the app that consumes it — the `Store`
 * interface is the contract, and both sides satisfy it independently. The optional fields are
 * optional for the same reason there: absent means *not known*, and a security dashboard has
 * to be able to tell that apart from a value.
 */
export interface PgRepoRecord {
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

/** The org shape the API's `Store` interface expects, kept in one place now it has six fields. */
interface OrgRow {
  id: string;
  planTier: PlanTier;
  llmEnabled: boolean;
  agentLoopEnabled: boolean;
  githubOrgLogin?: string;
  installationId?: number;
}

function toOrgRow(row: typeof schema.organizations.$inferSelect): OrgRow {
  return {
    id: row.id,
    planTier: row.planTier as PlanTier,
    llmEnabled: row.llmAnalysisEnabled,
    agentLoopEnabled: row.agentLoopEnabled,
    // Absent rather than null: a tenant with no GitHub linkage has none, and `undefined` is
    // what every consumer already tests for.
    ...(row.githubOrgLogin ? { githubOrgLogin: row.githubOrgLogin } : {}),
    ...(row.githubInstallationId !== null ? { installationId: row.githubInstallationId } : {}),
  };
}

export class PgStore {
  private readonly db: ReturnType<typeof drizzle>;
  private readonly client: postgres.Sql;

  constructor(connectionString: string) {
    this.client = postgres(connectionString, { max: 10 });
    this.db = drizzle(this.client, { schema });
  }

  async close(): Promise<void> {
    await this.client.end();
  }

  async upsertOrg(org: OrgRow): Promise<OrgRow> {
    await this.db
      .insert(schema.organizations)
      .values({
        id: org.id,
        name: org.id,
        slug: org.id,
        planTier: org.planTier as "free" | "team" | "scale",
        llmAnalysisEnabled: org.llmEnabled,
        agentLoopEnabled: org.agentLoopEnabled,
        ...(org.githubOrgLogin ? { githubOrgLogin: org.githubOrgLogin } : {}),
        ...(org.installationId !== undefined ? { githubInstallationId: org.installationId } : {}),
      })
      .onConflictDoUpdate({
        target: schema.organizations.id,
        set: {
          planTier: org.planTier as "free" | "team" | "scale",
          llmAnalysisEnabled: org.llmEnabled,
          agentLoopEnabled: org.agentLoopEnabled,
          // Each is set only when supplied. An upsert from a path that does not know the
          // GitHub linkage — a settings PATCH, say — must not blank it out, because that would
          // silently turn a GitHub-backed tenant into a hand-made one and cut off the very
          // membership lookup that decides who may sign into it.
          ...(org.githubOrgLogin ? { githubOrgLogin: org.githubOrgLogin } : {}),
          ...(org.installationId !== undefined ? { githubInstallationId: org.installationId } : {}),
        },
      });
    return org;
  }

  async getOrg(orgId: string): Promise<OrgRow | undefined> {
    const row = await this.db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
    return row[0] ? toOrgRow(row[0]) : undefined;
  }

  /** Orgs provisioned from a GitHub App installation, by GitHub login. */
  async listOrgsByGithubLogin(logins: readonly string[]): Promise<OrgRow[]> {
    if (logins.length === 0) return [];
    const rows = await this.db
      .select()
      .from(schema.organizations)
      .where(inArray(schema.organizations.githubOrgLogin, [...logins]));
    return rows.map(toOrgRow);
  }

  async putScan(scan: {
    id: string;
    orgId: string;
    doc: {
      scan: { rulesetVersion: string };
      findings: Array<{
        fingerprint: string;
        tier: string;
        classId: string;
        severity: string;
        locations: unknown;
        surfaces: string[];
        reproduction?: unknown | null;
        confidence?: number | null;
        explanation: string;
        suggestedFix?: SuggestedFix;
      }>;
    };
    disputes: Map<string, string>;
  }): Promise<void> {
    await this.db
      .insert(schema.scans)
      .values({
        id: scan.id,
        orgId: scan.orgId,
        trigger: "manual",
        executionMode: "hosted",
        rulesetVersion: scan.doc.scan.rulesetVersion,
        status: "completed",
        stageTimings: "{}",
      })
      .onConflictDoNothing();

    if (scan.doc.findings.length > 0) {
      // Ids are minted up front so the suggested fixes below can reference their finding.
      const rows = scan.doc.findings.map((f) => ({ id: randomUUID(), finding: f }));

      await this.db
        .insert(schema.findings)
        .values(
          rows.map(({ id, finding: f }) => ({
            id,
            orgId: scan.orgId,
            scanId: scan.id,
            fingerprint: f.fingerprint,
            tier: f.tier as "verified" | "research",
            classId: f.classId,
            severity: f.severity as "critical" | "high" | "medium" | "low",
            locations: JSON.stringify(f.locations),
            surfaces: f.surfaces,
            reproduction: f.reproduction ? JSON.stringify(f.reproduction) : null,
            confidence: f.confidence?.toString() ?? null,
            explanation: f.explanation,
            status: "open" as const,
          })),
        )
        .onConflictDoNothing();

      /*
       * Suggested fixes are persisted alongside the finding rather than dropped.
       *
       * They used to be dropped: this store maps a finding column by column, and there was no
       * column for `suggestedFix`. That was harmless only while nothing generated one. Now the
       * pipeline does, and losing it here would mean the Findings page showed guidance in dev
       * (in-memory store keeps the whole document) and nothing in production — with the fix-PR
       * action reporting "no applicable fix" for a scan that plainly had one.
       *
       * `content` holds the whole `SuggestedFix` as JSON, which is what the column's existing
       * `// jsonb` annotation always intended, so no migration is needed.
       */
      const fixes = rows.filter(({ finding }) => finding.suggestedFix);
      if (fixes.length > 0) {
        await this.db
          .insert(schema.suggestedFixes)
          .values(
            fixes.map(({ id, finding }) => ({
              id: randomUUID(),
              findingId: id,
              kind: finding.suggestedFix!.kind,
              content: JSON.stringify(finding.suggestedFix),
            })),
          )
          .onConflictDoNothing();
      }
    }
  }

  /**
   * Suggested fixes for a set of finding rows, keyed by finding id.
   *
   * A stored fix that no longer parses is skipped rather than thrown: a finding without its
   * remediation is degraded, but a findings list that fails to load is broken.
   */
  private async fixesByFindingId(findingIds: string[]): Promise<Map<string, SuggestedFix>> {
    const out = new Map<string, SuggestedFix>();
    if (findingIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(schema.suggestedFixes)
      .where(inArray(schema.suggestedFixes.findingId, findingIds));
    for (const row of rows) {
      try {
        out.set(row.findingId, JSON.parse(row.content) as SuggestedFix);
      } catch {
        continue;
      }
    }
    return out;
  }

  async getScan(scanId: string): Promise<
    | {
        id: string;
        orgId: string;
        doc: FindingsDocument;
        disputes: Map<string, string>;
        createdAt: string;
      }
    | undefined
  > {
    const scanRow = await this.db.select().from(schema.scans).where(eq(schema.scans.id, scanId)).limit(1);
    if (!scanRow[0]) return undefined;

    const findingRows = await this.db.select().from(schema.findings).where(eq(schema.findings.scanId, scanId));
    const fixes = await this.fixesByFindingId(findingRows.map((r) => r.id));

    const findings = findingRows.map((r) => {
      const f: Finding = {
        fingerprint: r.fingerprint,
        classId: r.classId,
        severity: r.severity as Finding["severity"],
        surfaces: r.surfaces as Finding["surfaces"],
        locations: JSON.parse(r.locations) as Location[],
        explanation: r.explanation,
        tier: r.tier as Finding["tier"],
      } as Finding;
      if (f.tier === "verified") {
        f.reproduction = r.reproduction ? JSON.parse(r.reproduction) : undefined;
      } else {
        f.confidence = r.confidence ? Number(r.confidence) : 0;
      }
      const fix = fixes.get(r.id);
      if (fix) f.suggestedFix = fix;
      return f;
    });

    return {
      id: scanRow[0].id,
      orgId: scanRow[0].orgId,
      doc: {
        schema: "gatepass.findings/1",
        scan: {
          id: scanRow[0].id,
          rulesetVersion: scanRow[0].rulesetVersion,
          executionMode: scanRow[0].executionMode as "hosted" | "runner" | "cli",
          surfacesScanned: [],
        },
        findings,
      },
      createdAt: scanRow[0].createdAt.toISOString(),
      disputes: new Map<string, string>(),
    };
  }

  async findingsOf(scanId: string, includeSuppressed = false): Promise<Finding[]> {
    const rows = (await this.db.select().from(schema.findings).where(eq(schema.findings.scanId, scanId))).filter(
      (r) => includeSuppressed || r.status !== "suppressed",
    );
    // Fetched after the suppression filter so a suppressed finding's fix is never even read.
    const fixes = await this.fixesByFindingId(rows.map((r) => r.id));

    return rows.map((r) => {
      const f: Finding = {
        fingerprint: r.fingerprint,
        classId: r.classId,
        severity: r.severity as Finding["severity"],
        surfaces: r.surfaces as Finding["surfaces"],
        locations: JSON.parse(r.locations) as Location[],
        explanation: r.explanation,
        tier: r.tier as Finding["tier"],
      } as Finding;
      if (f.tier === "verified") {
        f.reproduction = r.reproduction ? JSON.parse(r.reproduction) : undefined;
      } else {
        f.confidence = r.confidence ? Number(r.confidence) : 0;
      }
      const fix = fixes.get(r.id);
      if (fix) f.suggestedFix = fix;
      return f;
    });
  }

  async suppress(orgId: string, fingerprint: string): Promise<void> {
    await this.db
      .update(schema.findings)
      .set({ status: "suppressed" })
      .where(and(eq(schema.findings.orgId, orgId), eq(schema.findings.fingerprint, fingerprint)));
  }

  async isSuppressed(orgId: string, fingerprint: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.findings.id })
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.orgId, orgId),
          eq(schema.findings.fingerprint, fingerprint),
          eq(schema.findings.status, "suppressed"),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Withdraw one issued session token until its own expiry.
   *
   * `onConflictDoNothing` because revoking twice is the same statement as revoking once — a
   * second sign-out, or two tabs signing out together, must not error.
   */
  async revokeSession(jti: string, expiresAt: number): Promise<void> {
    await this.db
      .insert(schema.revokedSessions)
      .values({ jti, expiresAt: new Date(expiresAt * 1000) })
      .onConflictDoNothing();
  }

  async isSessionRevoked(jti: string): Promise<boolean> {
    const rows = await this.db
      .select({ jti: schema.revokedSessions.jti })
      .from(schema.revokedSessions)
      .where(eq(schema.revokedSessions.jti, jti))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Cache one user's GitHub-derived access.
   *
   * `accessToken` is written only when supplied, so a refresh — which has no new token, only a
   * new grant — cannot blank out the one thing that makes the *next* refresh possible. Losing
   * it would silently freeze that user's access at whatever was last cached until they signed
   * in again, which is exactly the staleness the TTL exists to prevent.
   */
  async putUserAccess(record: {
    githubUserId: string;
    login: string;
    grant: unknown;
    accessToken?: string;
    refreshedAt: string;
  }): Promise<void> {
    const refreshedAt = new Date(record.refreshedAt);
    await this.db
      .insert(schema.userAccessGrants)
      .values({
        githubUserId: record.githubUserId,
        login: record.login,
        grant: record.grant,
        ...(record.accessToken ? { accessToken: record.accessToken } : {}),
        refreshedAt,
      })
      .onConflictDoUpdate({
        target: schema.userAccessGrants.githubUserId,
        set: {
          login: record.login,
          grant: record.grant,
          ...(record.accessToken ? { accessToken: record.accessToken } : {}),
          refreshedAt,
        },
      });
  }

  async getUserAccess(githubUserId: string): Promise<
    | {
        githubUserId: string;
        login: string;
        grant: unknown;
        accessToken?: string;
        refreshedAt: string;
      }
    | undefined
  > {
    const rows = await this.db
      .select()
      .from(schema.userAccessGrants)
      .where(eq(schema.userAccessGrants.githubUserId, githubUserId))
      .limit(1);
    const row = rows[0];
    if (!row) return undefined;
    return {
      githubUserId: row.githubUserId,
      login: row.login,
      grant: row.grant,
      ...(row.accessToken ? { accessToken: row.accessToken } : {}),
      refreshedAt: row.refreshedAt.toISOString(),
    };
  }

  /** Forget a grant **and the stored GitHub token with it**. Called on sign-out. */
  async deleteUserAccess(githubUserId: string): Promise<void> {
    await this.db.delete(schema.userAccessGrants).where(eq(schema.userAccessGrants.githubUserId, githubUserId));
  }

  async upsertFleetServer(server: {
    id: string;
    orgId: string;
    name: string;
    endpointOrRepo: string;
    configHash: string;
    lastScanId?: string;
    posture: "unscanned" | "passing" | "findings_open" | "critical";
  }): Promise<{
    id: string;
    orgId: string;
    name: string;
    endpointOrRepo: string;
    configHash: string;
    lastScanId?: string;
    posture: "unscanned" | "passing" | "findings_open" | "critical";
  }> {
    await this.db
      .insert(schema.fleetServers)
      .values({
        id: server.id,
        orgId: server.orgId,
        name: server.name,
        endpointOrRepo: server.endpointOrRepo,
        configHash: server.configHash,
        posture: server.posture as "unscanned" | "passing" | "findings_open" | "critical",
        lastScanId: server.lastScanId ?? null,
      })
      .onConflictDoUpdate({
        target: schema.fleetServers.id,
        set: {
          posture: server.posture as "unscanned" | "passing" | "findings_open" | "critical",
          configHash: server.configHash,
          lastScanId: server.lastScanId ?? null,
        },
      });
    return server;
  }

  async getFleetServer(serverId: string): Promise<
    | {
        id: string;
        orgId: string;
        name: string;
        endpointOrRepo: string;
        configHash: string;
        lastScanId?: string;
        posture: "unscanned" | "passing" | "findings_open" | "critical";
      }
    | undefined
  > {
    const row = await this.db.select().from(schema.fleetServers).where(eq(schema.fleetServers.id, serverId)).limit(1);
    if (!row[0]) return undefined;
    return {
      id: row[0].id,
      orgId: row[0].orgId,
      name: row[0].name,
      endpointOrRepo: row[0].endpointOrRepo,
      configHash: row[0].configHash ?? "",
      lastScanId: row[0].lastScanId ?? undefined,
      posture: row[0].posture,
    };
  }

  async fleetView(orgId: string): Promise<{
    servers: Array<{
      id: string;
      orgId: string;
      name: string;
      endpointOrRepo: string;
      configHash: string;
      lastScanId?: string;
      posture: "unscanned" | "passing" | "findings_open" | "critical";
    }>;
    rollup: Record<string, number>;
  }> {
    const rows = await this.db.select().from(schema.fleetServers).where(eq(schema.fleetServers.orgId, orgId));

    const servers = rows.map((r) => ({
      id: r.id,
      orgId: r.orgId,
      name: r.name,
      endpointOrRepo: r.endpointOrRepo,
      configHash: r.configHash ?? "",
      lastScanId: r.lastScanId ?? undefined,
      posture: r.posture,
    }));

    const rollup: Record<string, number> = {
      total: servers.length,
      unscanned: 0,
      passing: 0,
      findings_open: 0,
      critical: 0,
    };
    for (const s of servers) {
      rollup[s.posture] = (rollup[s.posture] ?? 0) + 1;
    }

    return { servers, rollup };
  }

  // ── Connected repositories ──────────────────────────────────────────────
  //
  // `putRepo` / `getRepos` were on the Store interface as optional methods and PgStore simply
  // did not have them, so `GET /orgs/:org/repos` answered `[]` on every Postgres deployment
  // while answering correctly in memory. Optional-method guards turned missing persistence
  // into a plausible-looking empty list, which is the worst way for a gap to present itself.

  private rowToRepo(r: typeof schema.repositories.$inferSelect): PgRepoRecord {
    return {
      orgId: r.orgId,
      name: r.name,
      source: r.source === "local_path" ? "local_path" : "github",
      // NULL means "we never read this from GitHub" and must stay absent, not become a guess.
      ...(r.visibility === "public" || r.visibility === "private" ? { visibility: r.visibility } : {}),
      ...(r.githubRepoId !== null ? { githubRepoId: r.githubRepoId } : {}),
      ...(r.defaultBranch ? { defaultBranch: r.defaultBranch } : {}),
      frameworks: r.frameworksDetected ?? [],
      gateMode: r.gateMode,
      gateFailureMode: r.gateFailureMode,
      agentLoopEnabled: r.agentLoopEnabled,
      ...(r.lastScanId ? { lastScanId: r.lastScanId } : {}),
      ...(r.lastScanAt ? { lastScanAt: r.lastScanAt.toISOString() } : {}),
      connectedAt: r.createdAt.toISOString(),
    };
  }

  async connectRepo(repo: PgRepoRecord): Promise<PgRepoRecord> {
    await this.db
      .insert(schema.repositories)
      .values({
        id: randomUUID(),
        orgId: repo.orgId,
        name: repo.name,
        source: repo.source,
        githubRepoId: repo.githubRepoId ?? null,
        visibility: repo.visibility ?? null,
        defaultBranch: repo.defaultBranch ?? null,
        frameworksDetected: repo.frameworks,
        gateMode: repo.gateMode,
        gateFailureMode: repo.gateFailureMode,
        agentLoopEnabled: repo.agentLoopEnabled,
      })
      // Idempotent, and narrow: re-connecting refreshes only what GitHub tells us. Gate
      // settings and scan history are an operator's, not a connect call's, to change.
      .onConflictDoUpdate({
        target: [schema.repositories.orgId, schema.repositories.name],
        set: {
          ...(repo.githubRepoId !== undefined ? { githubRepoId: repo.githubRepoId } : {}),
          ...(repo.visibility ? { visibility: repo.visibility } : {}),
          ...(repo.defaultBranch ? { defaultBranch: repo.defaultBranch } : {}),
        },
      });
    return (await this.getRepo(repo.orgId, repo.name))!;
  }

  async putRepo(
    orgId: string,
    repoPath: string,
    scanId: string,
    meta: {
      frameworks?: string[];
      source?: "github" | "local_path";
      visibility?: "public" | "private";
      githubRepoId?: number;
      defaultBranch?: string;
    } = {},
  ): Promise<void> {
    const now = new Date();
    await this.db
      .insert(schema.repositories)
      .values({
        id: randomUUID(),
        orgId,
        name: repoPath,
        source: meta.source ?? (/^[\w.-]+\/[\w.-]+$/.test(repoPath) ? "github" : "local_path"),
        githubRepoId: meta.githubRepoId ?? null,
        visibility: meta.visibility ?? null,
        defaultBranch: meta.defaultBranch ?? null,
        frameworksDetected: meta.frameworks ?? [],
        lastScanId: scanId,
        lastScanAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.repositories.orgId, schema.repositories.name],
        set: {
          lastScanId: scanId,
          lastScanAt: now,
          ...(meta.frameworks ? { frameworksDetected: meta.frameworks } : {}),
          ...(meta.visibility ? { visibility: meta.visibility } : {}),
          ...(meta.githubRepoId !== undefined ? { githubRepoId: meta.githubRepoId } : {}),
          ...(meta.defaultBranch ? { defaultBranch: meta.defaultBranch } : {}),
        },
      });
  }

  async getRepos(orgId: string): Promise<PgRepoRecord[]> {
    const rows = await this.db.select().from(schema.repositories).where(eq(schema.repositories.orgId, orgId));
    return rows.map((r) => this.rowToRepo(r));
  }

  async getRepo(orgId: string, name: string): Promise<PgRepoRecord | undefined> {
    const rows = await this.db
      .select()
      .from(schema.repositories)
      .where(and(eq(schema.repositories.orgId, orgId), eq(schema.repositories.name, name)))
      .limit(1);
    return rows[0] ? this.rowToRepo(rows[0]) : undefined;
  }

  async updateRepo(
    orgId: string,
    name: string,
    patch: {
      gateMode?: "off" | "block_verified" | "block_threshold";
      gateFailureMode?: "fail_open" | "fail_closed";
      agentLoopEnabled?: boolean;
    },
  ): Promise<PgRepoRecord | undefined> {
    const set = {
      ...(patch.gateMode ? { gateMode: patch.gateMode } : {}),
      ...(patch.gateFailureMode ? { gateFailureMode: patch.gateFailureMode } : {}),
      ...(typeof patch.agentLoopEnabled === "boolean" ? { agentLoopEnabled: patch.agentLoopEnabled } : {}),
    };
    if (Object.keys(set).length > 0) {
      await this.db
        .update(schema.repositories)
        .set(set)
        .where(and(eq(schema.repositories.orgId, orgId), eq(schema.repositories.name, name)));
    }
    return this.getRepo(orgId, name);
  }

  /** Disconnect. Scans and findings are deliberately untouched — they are what was true. */
  async deleteRepo(orgId: string, name: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.repositories)
      .where(and(eq(schema.repositories.orgId, orgId), eq(schema.repositories.name, name)))
      .returning({ id: schema.repositories.id });
    return rows.length > 0;
  }

  async getBenchmark(corpusVersion?: string): Promise<unknown> {
    if (corpusVersion) {
      const rows = await this.db
        .select()
        .from(schema.benchmarkRuns)
        .where(eq(schema.benchmarkRuns.corpusVersion, corpusVersion));
      return {
        corpusVersion,
        publishedAt: rows[0]?.publishedAt?.toISOString() ?? null,
        runs: rows.map((r) => ({
          id: r.id,
          tool: r.tool,
          results: JSON.parse(r.results),
        })),
      };
    }
    const rows = await this.db.select().from(schema.benchmarkRuns);
    const byVersion = new Map<string, unknown[]>();
    for (const r of rows) {
      const arr = byVersion.get(r.corpusVersion) ?? [];
      arr.push({ id: r.id, tool: r.tool, results: JSON.parse(r.results) });
      byVersion.set(r.corpusVersion, arr);
    }
    return [...byVersion.entries()].map(([corpusVersion, runs]) => ({
      corpusVersion,
      runs,
    }));
  }

  async publishBenchmark(corpusVersion: string, tool: string, results: string): Promise<void> {
    await this.db.insert(schema.benchmarkRuns).values({
      id: randomUUID(),
      corpusVersion,
      tool,
      results,
    });
  }
}
