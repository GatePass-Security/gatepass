import { randomUUID, createHash } from "node:crypto";
import { buildScanContext, detectFrameworks } from "@gatepass/engine";
import { runScan, runScanAsync } from "@gatepass/detectors";
import { LlmGateway } from "@gatepass/semantic";
import { toSarif, parseFindingsDocument, diffFindings, type Finding } from "@gatepass/findings";
import {
  evaluateGate,
  verifyAndParseWebhook,
  shouldScan,
  Remediator,
  FixPullRequestOpener,
  FixPullRequestError,
  FIX_PR_UNCONFIGURED,
  type GateConfig,
  type WebhookHeaders,
} from "@gatepass/github";
import {
  AuditedWriter,
  InMemoryAuditSink,
  createSession,
  verifySession,
  roleFromGitHubOrgRole,
  verifyPassword,
  verifyNothing,
  type Role,
  type Session,
} from "@gatepass/shared";
import {
  authorizeUrl,
  exchangeCodeForUser,
  fetchOrgMembership,
  REPO_SLUG,
  type GitHubUser,
  type OAuthConfig,
  type OrgGrant,
  type RepoDirectory,
} from "@gatepass/github";
import { scopeAllows, type AccessDirectory, type ViewerScope } from "./access.js";
import type { LocalUser } from "./auth.js";
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
import {
  newRepoRecord,
  type Store,
  type StoredScan,
  type FleetServer,
  type OrgRecord,
  type RepoRecord,
  type RepoSettingsPatch,
} from "./store.js";

/**
 * API handlers wiring the analysis, gate, evidence, and runner libraries over the store.
 * Pure functions (request â†’ result) so they are unit-testable without a running server; the
 * HTTP binding in server.ts is a thin adapter. RBAC/auth and DB persistence are the two
 * production swap-ins (both stubbed here as an in-memory store + trusted caller).
 */

const RULESET_VERSION = "2026.07.0";

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
/**
 * A capability this build supports but this deployment has not been given credentials for.
 *
 * Distinct from `ForbiddenError` (the caller may not) and from a bare `Error` (something broke):
 * nothing is wrong, an operator simply has not configured it. It maps to 501, matching
 * `GET /v1/auth/github/login`, which already answers 501 rather than 500 for the same reason —
 * a 500 tells a client to retry and an on-call engineer to investigate, and both are wrong here.
 */
export class NotConfiguredError extends Error {}

/**
 * A sign-in attempt that did not authenticate.
 *
 * Its own class so the HTTP layer answers 401 rather than the 403 a `ForbiddenError` would give.
 * The distinction is not pedantic: 403 means "we know who you are and the answer is no", which
 * for a failed password is a claim we cannot make and a hint we should not give.
 */
export class AuthFailedError extends Error {}

import type { LlmTransport } from "@gatepass/semantic";
import type { GitHubClient, RepoFetcher, FixPullRequestClient } from "@gatepass/github";

export interface HandlerOptions {
  /** LLM transport for research-tier refinement. Production wires the NVIDIA NIM transport;
   *  absent means static-only (research findings keep heuristic confidence). */
  llmTransport?: LlmTransport;
  llmModel?: string;
  /** GitHub App client for PR review and check-run delivery (T096). */
  githubClient?: GitHubClient;
  /**
   * Opt-in code-writing client for suggested-fix pull requests. Absent ⇒ the fix-PR route
   * fails cleanly and Gatepass cannot write to a repository at all. Kept separate from
   * `githubClient` on purpose — see packages/github/src/fix-pr.ts.
   */
  fixPrClient?: FixPullRequestClient;
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
  /**
   * The org a successful sign-in belongs to. This is deliberately server-side configuration
   * and NOT a request parameter: `authCallback` used to take `orgId` from the POST body, so
   * anyone who completed OAuth could mint a session for any org id they cared to name.
   */
  sessionOrgId?: string;
  /**
   * GitHub organization whose membership admits a user and decides their role. An active owner
   * signs in as `admin`, an active member as `member`. **Anyone else is refused a session** —
   * see `admit` below for why that is not `viewer`.
   */
  githubOrgLogin?: string;
  /**
   * Explicit allow-list of GitHub logins, for deployments with no organization to check against
   * — a personal account, or a contractor outside the org. Entries are `login` or `login:role`;
   * a bare login gets `defaultRole`.
   */
  allowedLogins?: readonly { login: string; role?: Role }[];
  /**
   * Role for an allow-listed user who did not name one. Defaults to `viewer`, because "we could
   * not establish that this person may write" has to resolve to read-only rather than to trust.
   */
  defaultRole?: Role;
  /** Local development sign-in. See `devAuthEnabled` in auth.ts — never true in production. */
  devAuth?: boolean;
  /** Org a dev session is issued against. */
  devOrgId?: string;
  /**
   * Read-only GitHub repository discovery for the connect flow. Absent ⇒ connecting by
   * installation reports itself unavailable; connecting by `owner/name` still works, it just
   * cannot learn the repository's visibility.
   */
  repoDirectory?: RepoDirectory;
  /**
   * GitHub-derived access: which orgs a user reaches and which repositories within them.
   *
   * Present ⇒ this deployment's tenants are GitHub organizations, sign-in is admitted by
   * having access to at least one of them, and every repository-shaped read is narrowed to
   * what GitHub says the caller may see. Absent ⇒ the older single-org posture, admitted by
   * `githubOrgLogin` or `allowedLogins` and unrestricted within that org.
   */
  accessDirectory?: AccessDirectory;
  /**
   * Local password accounts — a sign-in that needs no GitHub account at all.
   *
   * This exists so somebody can be handed a look at a live deployment: a reviewer, an investor,
   * an auditor. They sign in, see the product, and connect GitHub from inside the dashboard if
   * and when they want to (`linkGitHub`), rather than being asked to authorize an OAuth app
   * against their personal GitHub account before they have seen anything.
   *
   * Empty ⇒ the door does not exist. It is not a fallback for a misconfigured GitHub sign-in
   * and never opens on its own.
   */
  localUsers?: readonly LocalUser[];
  /**
   * Whether the store holds at least one local account, resolved once at boot.
   *
   * `authConfig` is on the hot path for the login page and must stay synchronous, so it cannot
   * go and count rows. This is that count, taken when the server started — which is accurate
   * enough for its only job, deciding whether to render a form. Getting it wrong costs a login
   * page that offers a form nobody can use, or omits one somebody could; never access.
   */
  hasStoredAccounts?: boolean;
  /**
   * Plan tier an org gets when it is provisioned by a GitHub App installation. Defaults to
   * `free`; billing decides the real value and is not this module's business.
   */
  provisionedPlanTier?: PlanTier;
}

/** Dev sessions are hours, not the 7 days a real sign-in gets. */
const DEV_SESSION_TTL_SEC = 12 * 3600;

/**
 * Local password sessions last a day, not the seven a GitHub sign-in gets.
 *
 * A password account is shared by nature — that is what it is for — so the window in which a
 * token taken from one of those machines stays useful should be the short one.
 */
const LOCAL_SESSION_TTL_SEC = 24 * 3600;

/** A local-path scan target is anything that is not an `owner/name` slug. */
function repoSourceOf(name: string): "github" | "local_path" {
  return REPO_SLUG.test(name) ? "github" : "local_path";
}

export function makeHandlers(store: Store, options: HandlerOptions = {}) {
  /*
   * Signing key for session tokens.
   *
   * A configured SESSION_SECRET is always used as-is. When there is none but the local
   * development sign-in is on, one is generated for the lifetime of this process so the dev
   * path exercises exactly the same signed-token code as production rather than a bypass —
   * the door is different, the lock is not. Restarting the API invalidates dev sessions,
   * which is the correct trade for a key that is never written down.
   *
   * This cannot leak into production: `devAuth` is false there by construction (auth.ts).
   */
  const sessionSecret = options.sessionSecret ?? (options.devAuth ? randomUUID() + randomUUID() : undefined);
  const sessionOrgId = options.sessionOrgId ?? options.webhookOrgId ?? "demo";

  /**
   * Decide whether this person may have a session at all, and at what role.
   *
   * This used to only pick a role, and that was the hole. A GitHub OAuth app will complete the
   * flow for *any* GitHub account on the internet — there is no allow-list built into OAuth —
   * and a non-member was handed a `viewer` session rather than being turned away. Since a
   * session is what the API requires to read, `viewer` meant any stranger could read every
   * finding, scan and repository in the org. For a product whose whole content is "here are the
   * exploitable holes in this company's code", that is the worst possible read to leak.
   *
   * So membership is now admission, not merely a role input. Two ways in, and a deployment must
   * configure at least one:
   *
   *   - `githubOrgLogin` — an *active* member of that GitHub org. Owner ⇒ admin, member ⇒
   *     member. A pending invitation is not membership.
   *   - `allowedLogins` — named logins, for a personal account or someone outside the org.
   *
   * Neither configured ⇒ nobody is admitted. That is deliberately unusable rather than
   * deliberately open: an operator who has not said who may sign in has not said "everyone",
   * and the login page names exactly what to set. A GitHub outage denies rather than admits,
   * for the same reason — an outage must never be a way in.
   */
  /**
   * Provision the Gatepass tenant for a GitHub org the user reaches, if it does not exist yet.
   *
   * There is no sign-up form and no operator step: installing the App on an organization *is*
   * the act that creates the tenant, and the first person to sign in from that installation
   * brings the row into being. The org id is the GitHub login, so the tenant and the
   * organization are the same name in the URL, in the database, and on GitHub.
   *
   * Idempotent, and deliberately does not touch an existing row's settings — a second person
   * signing in must not reset the plan tier or the org's LLM and agent-loop choices.
   */
  const ensureOrgFor = async (grant: OrgGrant): Promise<OrgRecord> => {
    const existing = await store.getOrg(grant.login);
    if (existing) return existing;
    return store.upsertOrg({
      id: grant.login,
      planTier: options.provisionedPlanTier ?? "free",
      llmEnabled: true,
      agentLoopEnabled: false,
      githubOrgLogin: grant.login,
      ...(grant.installationId !== undefined ? { installationId: grant.installationId } : {}),
    });
  };

  /** What a successful admission establishes: who, where, and at what level. */
  interface Admission {
    role: Role;
    orgId: string;
    /** The orgs this user reaches, when GitHub-derived access produced the admission. */
    orgs: OrgGrant[];
  }

  const admit = async (user: GitHubUser): Promise<Admission> => {
    /*
     * The product model first: a GitHub org installs Gatepass, and everyone GitHub says may
     * work on a repository in it may use Gatepass for that repository. If the user reaches at
     * least one such org, that is the admission and no list on our side is consulted.
     *
     * Which org they land in is the first one; every other is one click away in the switcher
     * (`switchOrg`), and each is re-checked against a fresh grant at that point.
     */
    if (options.accessDirectory) {
      const grant = await options.accessDirectory.record(user);
      const first = grant.orgs[0];
      if (first) {
        for (const org of grant.orgs) await ensureOrgFor(org);
        return { role: first.role, orgId: first.login, orgs: grant.orgs };
      }
    }

    const named = options.allowedLogins?.find((a) => a.login.toLowerCase() === user.login.toLowerCase());
    if (named) return { role: named.role ?? options.defaultRole ?? "viewer", orgId: sessionOrgId, orgs: [] };

    if (options.githubOrgLogin) {
      const membership = await fetchOrgMembership(options.githubOrgLogin, user.accessToken, options.oauthFetch).catch(
        () => undefined,
      );
      // `undefined` covers both "not a member" and "the lookup failed"; both must deny.
      if (membership && membership.state === "active") {
        const role = roleFromGitHubOrgRole(membership.role, membership.state);
        if (role !== "viewer") return { role, orgId: sessionOrgId, orgs: [] };
      }
      throw new ForbiddenError(
        `@${user.login} is not an active member of the "${options.githubOrgLogin}" GitHub organization, so this deployment will not open a session.`,
      );
    }

    /*
     * GitHub-derived access is configured and produced nothing. That is the ordinary answer
     * for someone whose organizations have not installed Gatepass, and it is the one refusal
     * a normal user will actually see — so it says what to do about it rather than describing
     * a configuration problem they cannot fix.
     */
    if (options.accessDirectory) {
      throw new ForbiddenError(
        `@${user.login}, Gatepass is not installed on any GitHub organization you have access to. ` +
          `Access here is exactly your GitHub access: ask an owner of your organization to install the ` +
          `Gatepass App, or to give you collaborator access to a repository it already covers.`,
      );
    }

    /*
     * Refused either way, but say which. An allow-list that exists and does not name this
     * person is a different situation from a deployment with no admission rule at all, and
     * telling an operator to "set GATEPASS_ALLOWED_LOGINS" when they already have would send
     * them to re-fix working configuration instead of adding one login to it.
     */
    if (options.allowedLogins && options.allowedLogins.length > 0) {
      throw new ForbiddenError(
        `@${user.login} is not on this deployment's list of permitted GitHub logins, so no session was opened.`,
      );
    }

    throw new ForbiddenError(
      "this deployment has not been told who may sign in. Set GATEPASS_GITHUB_ORG to a GitHub organization, or GATEPASS_ALLOWED_LOGINS to specific GitHub logins, on the API service.",
    );
  };

  const requireScan = async (scanId: string): Promise<StoredScan> => {
    const s = await store.getScan(scanId);
    if (!s) throw new NotFoundError(`scan ${scanId}`);
    return s;
  };

  /**
   * A scan, confirmed to belong to `orgId`.
   *
   * The HTTP layer runs this same check for every `/v1/scans/:id/*` path, and that stays — it
   * covers routes added later, which a per-handler check cannot. This exists because the HTTP
   * layer is not the only way in: `makeHandlers` is a plain object, and anything holding one
   * (the CLI, a worker, a future queue consumer) could previously read any scan by id from any
   * tenant. Two layers, because the failure mode is a customer reading another customer's
   * vulnerabilities.
   *
   * `orgId` is `undefined` only where the deployment has no sessions at all and therefore no
   * tenant to assert — the documented open posture for a single-tenant local API. It is a
   * required parameter rather than an optional one so that every call site has to decide.
   */
  const requireScanInOrg = async (scanId: string, orgId: string | undefined): Promise<StoredScan> => {
    const scan = await requireScan(scanId);
    if (orgId !== undefined && scan.orgId !== orgId) {
      throw new ForbiddenError(`scan ${scanId} does not belong to org "${orgId}"`);
    }
    return scan;
  };
  const requireOrg = async (orgId: string): Promise<OrgRecord> => {
    const o = await store.getOrg(orgId);
    if (!o) throw new NotFoundError(`org ${orgId}`);
    return o;
  };
  /**
   * The GitHub repository a scan came from, or undefined when it has none.
   *
   * A connected repo may be a local path on the API host rather than a remote, so the record's
   * own `source` decides — not a guess from the name. Without this check a directory scan
   * would send `/Users/...` to the GitHub API and fail with something unreadable.
   */
  const repoForScan = async (orgId: string, scanId: string): Promise<string | undefined> => {
    if (!store.getRepos) return undefined;
    const tracked = await store.getRepos(orgId);
    // Filter on `source` inside the search rather than checking the first match afterwards:
    // one scan can be attached to more than one record (the clone-and-scan path connects the
    // GitHub slug, while the temp workspace it ran in is connected as a local path), and
    // taking whichever came first would report "no repository" for a repo that plainly has one.
    return tracked.find((r) => r.lastScanId === scanId && r.source === "github")?.name;
  };

  const asPostureScan = async (s: StoredScan): Promise<PostureScan> => ({
    id: s.doc.scan.id,
    rulesetVersion: s.doc.scan.rulesetVersion,
    findings: await store.findingsOf(s.id),
  });

  /**
   * Shared scan logic: analyze a local directory, persist, return the summary.
   *
   * Also returns a reader over the scanned files. The PR-review builder needs the head
   * source to turn an insertion fix into a correct GitHub suggestion, and this context is
   * the only place it exists — the workspace is deleted immediately after, and the findings
   * document deliberately carries no source. Callers that do not post a review ignore it.
   */
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
    const frameworks = detectFrameworks(ctx);
    // The scan is where `frameworks` genuinely becomes knowable, so this is where the repo
    // record learns it. It used to be dropped, which is why the repos table could only ever
    // render a row of dashes in that column.
    const repoName = opts.repoRef ?? dir;
    if (store.putRepo)
      await store.putRepo(org.id, repoName, doc.scan.id, { frameworks, source: repoSourceOf(repoName) });
    const visible = await store.findingsOf(doc.scan.id);
    const contentByPath = new Map(ctx.files.map((f) => [f.relPath, f.content]));
    return {
      summary: {
        scanId: doc.scan.id,
        frameworks,
        verified: visible.filter((f) => f.tier === "verified").length,
        research: visible.filter((f) => f.tier === "research").length,
      },
      source: { read: (path: string) => contentByPath.get(path) },
    };
  };

  /**
   * A scan the caller's repository scope permits seeing.
   *
   * Throws `NotFoundError`, not `ForbiddenError`, and that is the point: a 403 on a scan id
   * confirms the scan exists and belongs to a repository in this org, which is exactly what
   * someone probing ids wants to learn. Under a repository-scoped view, a scan you may not see
   * is a scan that is not there.
   */
  const scopedScan = async (scope: ViewerScope | undefined, scan: StoredScan): Promise<StoredScan> => {
    if (!scope || scope.repos === null) return scan;
    if (!scopeAllows(scope, await repoForScan(scan.orgId, scan.id))) throw new NotFoundError(`scan ${scan.id}`);
    return scan;
  };

  /** Refuse a repository-named action the caller's grant does not cover. */
  const requireRepoInScope = (scope: ViewerScope | undefined, repo: string): void => {
    if (scopeAllows(scope, repo)) return;
    throw new ForbiddenError(
      `you do not have access to "${repo}" on GitHub, so Gatepass will not act on it. Access here is ` +
        `exactly your GitHub access: ask someone who administers that repository to add you as a collaborator.`,
    );
  };

  /**
   * Every route, built against one caller's repository scope.
   *
   * The scope is bound once per request by `forSession` rather than threaded through forty
   * call sites, for the same reason the HTTP layer keeps one route gate instead of a check per
   * route body: a handler added later inherits the scoping automatically, where a per-call-site
   * convention only holds until somebody forgets. `undefined` means no repository restriction
   * — see `ViewerScope` in access.ts for when that is the right answer and why it is not a hole.
   */
  const build = (scope: ViewerScope | undefined) => ({
    /**
     * The access this handler set is bound to, or undefined where none was established.
     *
     * Exposed so the HTTP layer can authorize against `scope.role` — GitHub's current answer —
     * rather than the role baked into the session token when it was issued. See the note at the
     * call site in server.ts.
     */
    viewerScope: (): ViewerScope | undefined => scope,

    /**
     * Scan a directory on the API host.
     *
     * `label` names the result in the dashboard when the caller knows a better identity than
     * the path — the bundled fixture is `corpus/eval-repos/vulnerable-nextjs-mcp` on every
     * machine, and rendering one developer's home directory instead is both meaningless to a
     * reader and a needless disclosure of the host's layout. It is not reachable over HTTP:
     * the route passes two arguments, so this is an in-process seam for the boot-time seed and
     * nothing else. It is still validated, because "unreachable today" is a property of the
     * current route table rather than of this function.
     */
    async createScan(orgId: string, repoPath: string, label?: string) {
      const org = await requireOrg(orgId);
      /*
       * `repoPath` is a path on the API host. Under a GitHub-derived scope that is refused
       * outright: the caller's access is a set of repositories GitHub vouched for, and a
       * directory on the server is not one of them — it is a way to point the scanner at
       * anything the API process can read.
       */
      requireRepoInScope(scope, repoPath);
      // A label that looks like a GitHub slug would make a local scan indistinguishable from a
      // scan of the real repository of that name — including to the scope check above.
      const named = label && !REPO_SLUG.test(label) && !label.startsWith("/") ? label : repoPath;
      return (await scanDirectory(org, repoPath, { repoRef: named })).summary;
    },

    /** Scan history for the dashboard overview: per-scan finding summaries, oldest first. */
    async listScans(orgId: string) {
      await requireOrg(orgId);
      if (!store.listScans) return [];
      const repos = store.getRepos ? await store.getRepos(orgId) : [];
      const byScan = new Map(repos.filter((r) => r.lastScanId).map((r) => [r.lastScanId!, r.name]));
      /*
       * Filtered, not just labelled. This list is the dashboard's history and the source of
       * every scan id the client then asks for findings with — so leaving another team's scans
       * in it while hiding their name would hand over the ids that unlock the findings anyway.
       */
      const scans = (await store.listScans(orgId)).filter((s) => scopeAllows(scope, byScan.get(s.id)));
      return Promise.all(
        scans.map(async (s) => {
          const findings = await store.findingsOf(s.id);
          const bySeverity: Record<string, number> = {};
          for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
          return {
            id: s.id,
            createdAt: s.createdAt,
            repo: repos.find((r) => r.lastScanId === s.id)?.name,
            // Provenance. A finding is only checkable against a specific commit — without one,
            // "we found this in owner/repo" is unfalsifiable the moment the branch moves.
            commitSha: s.doc.scan.commitSha,
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
      requireRepoInScope(scope, repo);
      if (!options.repoFetcher) throw new Error("no repo fetcher configured (set options.repoFetcher)");
      const ws = await options.repoFetcher.fetch(repo, ref);
      try {
        const { summary } = await scanDirectory(org, ws.dir, { commitSha: ws.sha, repoRef: repo });
        return { ...summary, repo, ref, sha: ws.sha };
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
        const { summary, source } = await scanDirectory(org, ws.dir, { commitSha: ws.sha, repoRef: repo });
        const headFindings = await store.findingsOf(summary.scanId);

        // Incremental: gate/review only on findings introduced by this change.
        const diff = baselineFindings ? diffFindings(baselineFindings, headFindings) : undefined;
        const reportFindings = diff ? diff.added : headFindings;

        // PR: deliver review + gate check run through the audited writer (if a client is wired).
        if (event.type === "pull_request" && options.githubClient) {
          const writer = new AuditedWriter(new InMemoryAuditSink(), "gatepass-webhook");
          const remediator = new Remediator(options.githubClient, writer);
          // The workspace is still mounted here (cleanup runs in the `finally` below), which
          // is what lets the review carry real click-to-apply suggestions.
          await remediator.deliverReview(orgId, repo, event.prNumber, reportFindings, source);
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

    /**
     * Which sign-in doors this deployment actually has.
     *
     * The login page reads this so it can render the truth instead of offering a GitHub
     * button that dead-ends on every machine without OAuth credentials. Both flags are
     * deployment configuration, not secrets: `devAuth` is false in production by
     * construction, so publishing it tells an attacker nothing they could act on.
     */
    authConfig() {
      return {
        github: Boolean(options.oauthConfig && sessionSecret),
        devAuth: Boolean(options.devAuth && sessionSecret),
        /*
         * Whether the local password form should be rendered. Publishing this tells an attacker
         * only that a form exists — which they would learn by looking at the page — and not
         * publishing it means the login page has to guess, and guesses wrong for exactly the
         * deployments that configured it.
         */
        password: Boolean(sessionSecret && (options.localUsers?.length || options.hasStoredAccounts)),
        orgId: sessionOrgId,
      };
    },

    /** Begin OAuth: the URL to send the user to. */
    authLoginUrl(state: string) {
      if (!options.oauthConfig) throw new Error("OAuth not configured");
      if (!state) throw new Error("missing OAuth state");
      return { url: authorizeUrl(options.oauthConfig, state) };
    },

    /**
     * OAuth callback: exchange the code, resolve the user's role, issue a signed session.
     *
     * Two things changed here and both were holes rather than gaps.
     *
     * The org is `options.sessionOrgId` — server configuration. It used to be `body.orgId`,
     * so any caller who completed OAuth against this deployment could name any org in the
     * request and receive a valid session for it. A session's tenant must never be something
     * the person holding it chose.
     *
     * The role is resolved, not assumed. It was hardcoded `"member"` for everyone, which made
     * the admin/member/viewer hierarchy inert. Now it comes from the user's GitHub
     * organization membership when one is configured to check against, and otherwise from
     * `defaultRole` — which defaults to `viewer`, so a deployment that has not told us how to
     * establish authority hands out read-only sessions rather than trusting.
     */
    async authCallback(code: string) {
      if (!options.oauthConfig || !sessionSecret) throw new Error("OAuth/session not configured");
      const user = await exchangeCodeForUser(code, options.oauthConfig, options.oauthFetch);
      const { role, orgId, orgs } = await admit(user);
      const token = createSession({ userId: String(user.githubUserId), login: user.login, orgId, role }, sessionSecret);
      return {
        token,
        user: { id: user.githubUserId, login: user.login },
        orgId,
        role,
        // Every org this account reaches, so the dashboard can offer the switcher on the first
        // page rather than after a second round-trip.
        orgs: orgs.map((o) => ({ id: o.login, role: o.role, repoCount: o.repos.length })),
      };
    },

    /**
     * Local password sign-in (`POST /v1/auth/password`).
     *
     * A real signed session through the same `createSession` as every other door — there is no
     * second verification path and no bypass in the guards downstream. What differs is only who
     * vouched for the user: here, a password this deployment was configured with.
     *
     * **Every failure returns the same message.** "No such user" and "wrong password" are the
     * same answer, because the difference is the first thing worth knowing before attacking an
     * account, and a login form that distinguishes them is an account-enumeration oracle. The
     * timing is levelled too: an unknown login still burns a full scrypt through `verifyNothing`,
     * so the fast path and the slow path cost the same.
     *
     * The session carries `userId: "local:<login>"`. Nothing else in the system mints that
     * prefix, so a local account can never collide with a GitHub user id — which matters because
     * `linkGitHub` below files a GitHub grant under exactly this id.
     */
    async passwordSignIn(login: string, password: string) {
      const configured = options.localUsers ?? [];
      /*
       * Both account sources are read up front, on every attempt, whatever the outcome.
       *
       * Reading the store only when the environment misses would make an unknown login cost one
       * more query than a known one — a difference an attacker can time, and the enumeration
       * channel `verifyNothing` exists to close. Doing it unconditionally keeps both paths
       * identical. It is a full read of the accounts collection, which is fine because this
       * table holds a handful of rows by design: it is the door for reviewers and for
       * bootstrapping, not a user system.
       */
      const stored = store.listLocalAccounts ? await store.listLocalAccounts() : [];
      if (!sessionSecret || (configured.length === 0 && stored.length === 0)) {
        // Nothing anywhere can ever authenticate, so this is not a refusal — the door does not
        // exist. Answering 401 here would send an operator who forgot to configure it off to
        // check a password, which is the one place the answer is not.
        throw new NotConfiguredError("password sign-in is not enabled on this deployment");
      }
      const clean = login.trim();
      /*
       * The environment wins over the database, for the login it names.
       *
       * Both are real sources — the database is where accounts live once there is one, and the
       * environment is how a deployment bootstraps the first account (and how an operator who
       * has locked themselves out gets back in). But they can disagree, and an ambiguous answer
       * to "which password is current" is the worst possible property for a credential.
       *
       * Environment-first makes rotation mean what an operator expects: change the variable,
       * restart, the old password stops working. Database-first would let a stale row silently
       * outrank the value they just edited.
       */
      const matches = (u: { login: string }) => u.login.toLowerCase() === clean.toLowerCase();
      const user = configured.find(matches) ?? stored.find(matches);
      const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyNothing(password);
      if (!ok || !user) throw new AuthFailedError("that username and password do not match an account here");

      const token = createSession(
        { userId: `local:${user.login}`, login: user.login, orgId: sessionOrgId, role: user.role },
        sessionSecret,
        LOCAL_SESSION_TTL_SEC,
      );
      return {
        token,
        user: { id: 0, login: user.login },
        orgId: sessionOrgId,
        role: user.role,
        local: true as const,
      };
    },

    /**
     * Attach GitHub access to the session that made this request
     * (`POST /v1/auth/github/link`).
     *
     * The other half of the local door. Somebody who signed in with a password can run the OAuth
     * flow from inside the dashboard, and the resulting grant is filed under **their existing
     * user id** rather than under the GitHub user id — so it augments the account they are
     * already using instead of quietly swapping them into a different one. The session token
     * they are holding keeps working; what changes is which orgs `switchOrg` will now let them
     * into.
     *
     * Their current org is unaffected. A local session's org is this deployment's own, no GitHub
     * grant covers it, and `scopeFor` therefore still returns no repository restriction there —
     * which is the right answer, because linking a GitHub account is not a statement about the
     * local tenant. Where the grant bites is the orgs it actually names.
     */
    async linkGitHub(session: Session, code: string) {
      if (!options.oauthConfig || !sessionSecret) throw new NotConfiguredError("OAuth is not configured");
      if (!options.accessDirectory) {
        throw new NotConfiguredError("this deployment does not derive access from GitHub, so there is nothing to link");
      }
      const user = await exchangeCodeForUser(code, options.oauthConfig, options.oauthFetch);
      const grant = await options.accessDirectory.record(user, session.userId);
      for (const org of grant.orgs) await ensureOrgFor(org);
      return {
        linked: { id: user.githubUserId, login: user.login },
        orgs: grant.orgs.map((o) => ({ id: o.login, role: o.role, repoCount: o.repos.length })),
      };
    },

    /**
     * Local development sign-in (`POST /v1/auth/dev-session`).
     *
     * Issues a real, signed, expiring session through exactly the same `createSession` the
     * OAuth path uses — there is no second verification path and no bypass in the guards. The
     * only difference is who is asked to vouch for the user, and here the answer is "nobody",
     * which is why it is unreachable unless the deployment explicitly opted in AND is not
     * production (auth.ts `devAuthEnabled`). It is labelled as a development session
     * everywhere it surfaces, and expires in hours rather than days.
     */
    devSession(login = "dev") {
      if (!options.devAuth || !sessionSecret) {
        throw new ForbiddenError("dev sign-in is not enabled on this deployment");
      }
      const clean = /^[\w.-]{1,39}$/.test(login) ? login : "dev";
      const orgId = options.devOrgId ?? sessionOrgId;
      const token = createSession(
        { userId: `dev:${clean}`, login: clean, orgId, role: "admin" },
        sessionSecret,
        DEV_SESSION_TTL_SEC,
      );
      return { token, user: { id: 0, login: clean }, orgId, role: "admin" as Role, development: true };
    },

    /**
     * Verify a session token (for the /auth/me route and RBAC guards).
     *
     * Two questions, not one: is the token authentic and unexpired (pure, in `verifySession`),
     * and has it since been withdrawn (a store lookup). The second is why this is async — a
     * revocation list that only one process can see is not a revocation list.
     */
    async verifySessionToken(token: string | undefined): Promise<Session | null> {
      if (!sessionSecret) return null;
      const session = verifySession(token, sessionSecret);
      if (!session) return null;
      if (store.isSessionRevoked && (await store.isSessionRevoked(session.jti))) return null;
      return session;
    },

    /**
     * End a session: the token that made this request stops working everywhere, not just in the
     * browser that had it. Idempotent — signing out twice is not an error.
     */
    async signOut(token: string | undefined): Promise<{ ok: true; revoked: boolean }> {
      if (!sessionSecret) return { ok: true, revoked: false };
      const session = verifySession(token, sessionSecret);
      if (!session) return { ok: true, revoked: false };
      /*
       * Signing out drops the cached grant *and the GitHub token stored with it*. Keeping a
       * usable GitHub credential for somebody who has ended their session would mean this
       * deployment held a live key to their repositories with nothing on our side still
       * representing them — worth nothing to us and worth a great deal to whoever read the
       * database.
       */
      await options.accessDirectory?.forget(session.userId);
      if (!store.revokeSession) return { ok: true, revoked: false };
      await store.revokeSession(session.jti, session.exp);
      return { ok: true, revoked: true };
    },

    /** Whether this deployment can actually withdraw a session, rather than only expire one. */
    revocationSupported(): boolean {
      return Boolean(sessionSecret && store.revokeSession && store.isSessionRevoked);
    },

    /** Whether this deployment can issue and check sessions at all. */
    sessionsEnabled(): boolean {
      return Boolean(sessionSecret);
    },

    async getFindings(orgId: string | undefined, scanId: string, includeSuppressed = false): Promise<Finding[]> {
      await scopedScan(scope, await requireScanInOrg(scanId, orgId));
      return store.findingsOf(scanId, includeSuppressed);
    },

    async getSarif(orgId: string | undefined, scanId: string) {
      const scan = await scopedScan(scope, await requireScanInOrg(scanId, orgId));
      return toSarif(scan.doc);
    },

    // Dispute -> suppress this fingerprint org-wide so it does not recur on unchanged code (FR-011, T087).
    // Route: POST /v1/findings/:fingerprint/dispute { scanId, reason }
    async disputeFinding(fingerprint: string, scanId: string, reason: string) {
      const scan = await scopedScan(scope, await requireScan(scanId));
      if (!scan.doc.findings.some((f) => f.fingerprint === fingerprint))
        throw new NotFoundError(`finding ${fingerprint}`);
      scan.disputes.set(fingerprint, reason);
      await store.suppress(scan.orgId, fingerprint);
      return { ok: true, suppressed: fingerprint };
    },

    /**
     * Opt-in agent-loop fix guidance (FR-014, T079): 403 unless the org enabled it.
     *
     * The fix now travels on the finding itself — it is generated during the scan, from the
     * source, and validated by the schema. So this reads it rather than regenerating it, and
     * a client that already has the finding sees exactly the same guidance the PR comment
     * and the dashboard show. Regenerating here (as this used to) meant the endpoint could
     * silently disagree with every other surface.
     */
    async agentGuidance(orgId: string, scanId: string, fingerprint: string) {
      const org = await requireOrg(orgId);
      if (!org.agentLoopEnabled) throw new ForbiddenError("agent-loop integration is not enabled for this org");
      const scan = await scopedScan(scope, await requireScan(scanId));
      const finding = scan.doc.findings.find((f) => f.fingerprint === fingerprint);
      if (!finding) throw new NotFoundError(`finding ${fingerprint}`);
      return {
        fingerprint,
        classId: finding.classId,
        guidance: finding.suggestedFix ?? {
          kind: "agent_guidance" as const,
          content:
            `Gatepass has no remediation guidance for the class "${finding.classId}". Every class the ` +
            `current ruleset emits does have guidance, so this finding came from a custom or newer rule ` +
            `than this deployment's fix generator. Work from the finding's explanation and reproduction, ` +
            `and treat the absence of guidance as a gap in Gatepass rather than a sign the finding is minor.`,
        },
      };
    },

    /**
     * Open a pull request containing this scan's suggested fixes (Principle III, as amended).
     *
     * Reachable ONLY from an explicit human action — there is no webhook path to it — and
     * only for an org that has turned it on. Everything else the constitution requires
     * (new branch, never the default branch, never CI config, never a force-push, never a
     * merge, always audited) is enforced inside `FixPullRequestOpener`, so those guarantees
     * hold for any caller rather than depending on this function staying careful.
     */
    async openFixPullRequest(
      orgId: string,
      scanId: string,
      opts: { fingerprints?: string[]; repo?: string; base?: string; requestedBy?: string } = {},
    ) {
      const org = await requireOrg(orgId);
      if (!org.fixPrEnabled) {
        throw new ForbiddenError("fix pull requests are not enabled for this org");
      }
      if (!options.fixPrClient) throw new NotConfiguredError(FIX_PR_UNCONFIGURED);
      const scan = await scopedScan(scope, await requireScan(scanId));
      if (scan.orgId !== orgId) throw new NotFoundError(`scan ${scanId}`);

      const repo = opts.repo ?? (await repoForScan(orgId, scanId));
      if (!repo) {
        throw new FixPullRequestError(
          "this scan is not associated with a GitHub repository, so there is nowhere to open a pull request. " +
            "Scans of a local path on the API host have no remote; re-scan the repository from GitHub first.",
        );
      }
      /*
       * Checked again against `repo` rather than relying on the scan check above, because
       * `opts.repo` lets the caller name a *different* repository than the one the scan came
       * from. This is the one route in the API that writes to a customer repository, so the
       * repository it is about to write to is the one that has to be in the caller's grant.
       */
      requireRepoInScope(scope, repo);

      const writer = new AuditedWriter(new InMemoryAuditSink(), opts.requestedBy ?? "gatepass-dashboard");
      const opener = new FixPullRequestOpener(options.fixPrClient, writer);
      // Suppressed (disputed) findings are excluded: a finding a human rejected must not
      // come back as a commit.
      const findings = await store.findingsOf(scan.id);
      return opener.open(orgId, repo, scan.id, findings, {
        fingerprints: opts.fingerprints,
        base: opts.base,
        requestedBy: opts.requestedBy,
      });
    },

    async evaluateGate(orgId: string | undefined, scanId: string, config: GateConfig) {
      const scan = await scopedScan(scope, await requireScanInOrg(scanId, orgId));
      return evaluateGate(config, { findings: await store.findingsOf(scan.id), scanCompleted: true });
    },

    async getEvidence(orgId: string, scanId: string) {
      const org = await requireOrg(orgId);
      requireFeature(org.planTier as PlanTier, "evidence_export");
      const scan = await scopedScan(scope, await requireScan(scanId));
      return evaluatePosture(await asPostureScan(scan));
    },

    // Push posture evidence to Vanta/Drata (FR-021, T083). Scale-tier gated; needs a token.
    async exportEvidence(orgId: string, scanId: string, platform: CompliancePlatform) {
      const org = await requireOrg(orgId);
      requireFeature(org.planTier as PlanTier, "evidence_export");
      const token = platform === "vanta" ? options.vantaToken : options.drataToken;
      if (!token) throw new ForbiddenError(`no ${platform} API token configured`);
      const scan = await scopedScan(scope, await requireScan(scanId));
      const items = evaluatePosture(await asPostureScan(scan));
      return new ApiEvidenceExporter(platform, token).export(items);
    },

    async draftQuestionnaire(orgId: string, scanId: string, format: SourceFormat, content: string) {
      const org = await requireOrg(orgId);
      requireFeature(org.planTier as PlanTier, "questionnaire_autofill");
      const scan = await scopedScan(scope, await requireScan(scanId));
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
      // Same reasoning as `createScan`: this reads a directory on the API host.
      requireRepoInScope(scope, repoPath);
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
     * PATCH /v1/orgs/:org/settings { llm_analysis_enabled?, agent_loop_enabled?, fix_pr_enabled? }
     *
     * Org-scoped toggles. Only these three fields are writable: plan tier is set
     * by billing, and the org id is its identity. Unknown keys are ignored rather
     * than merged, so a malformed body can never widen what is persisted. Returns
     * the full updated record so the caller reconciles against the server's state
     * instead of trusting its own optimistic copy.
     *
     * `fix_pr_enabled` is the consent that lets Gatepass write to a repository at
     * all. It is written the same way as the others deliberately — the audit trail
     * and the per-request human trigger are what bound the capability, not an
     * extra confirmation step here that a script would skip anyway.
     */
    async updateOrgSettings(orgId: string, patch: Record<string, unknown>) {
      const org = await requireOrg(orgId);
      const next: OrgRecord = {
        ...org,
        llmEnabled: typeof patch.llm_analysis_enabled === "boolean" ? patch.llm_analysis_enabled : org.llmEnabled,
        agentLoopEnabled:
          typeof patch.agent_loop_enabled === "boolean" ? patch.agent_loop_enabled : org.agentLoopEnabled,
        fixPrEnabled: typeof patch.fix_pr_enabled === "boolean" ? patch.fix_pr_enabled : org.fixPrEnabled,
      };
      return store.upsertOrg(next);
    },

    /**
     * GET /v1/orgs/:org/repos — the org's connected repositories.
     *
     * Every field is now read from the stored record. Three of them used to be literals:
     * `visibility` was the constant `"private"` for every row, `frameworks` was always `[]`,
     * and the gate columns were deployment defaults because per-repo settings were not
     * stored. The first is the one that mattered — a security dashboard printing "Private"
     * beside a public repository states something false about exposure. It is now emitted
     * only when GitHub actually told us, and is **omitted** otherwise so the UI has nothing
     * to render rather than something wrong.
     */
    async listRepos(orgId: string) {
      await requireOrg(orgId);
      if (!store.getRepos) return [];
      // The one list the whole "they do not see other repositories" promise rests on.
      return (await store.getRepos(orgId)).filter((r) => scopeAllows(scope, r.name)).map(toRepoView);
    },

    /**
     * GET /v1/orgs/:org/repos/available — repositories the Gatepass App installation can read
     * and this org has not connected yet.
     *
     * Read-only: `GET /installation/repositories` and nothing else (Constitution Principle
     * III, CLAUDE.md rule 2). `configured: false` is a normal answer — most deployments have
     * no GitHub App, and the caller falls back to connecting by `owner/name`.
     */
    async listAvailableRepos(orgId: string) {
      await requireOrg(orgId);
      if (!options.repoDirectory) return { configured: false, repos: [] };
      const connected = new Set(store.getRepos ? (await store.getRepos(orgId)).map((r) => r.name) : []);
      // A GitHub outage degrades to the same answer as "no App configured" rather than a 500.
      // The caller's fallback — connect by `owner/name` — works in both cases, so failing the
      // whole dialog because a listing call timed out would take away the door that still opens.
      const all = await options.repoDirectory.listInstallationRepos().catch(() => null);
      if (!all) return { configured: false, repos: [] };
      /*
       * Narrowed to the caller's own grant as well as to what is unconnected. The installation
       * covers every repository the org gave the App, which for an outside collaborator is
       * mostly repositories they cannot see — and a connect dialog listing them would leak the
       * org's private repository *names* to someone with access to two of them.
       */
      return {
        configured: true,
        repos: all.filter((r) => !connected.has(r.name) && scopeAllows(scope, r.name)),
      };
    },

    /**
     * POST /v1/orgs/:org/repos { repo } — connect a repository.
     *
     * A read plus a row: Gatepass asks GitHub what the repository is and records that it is
     * being watched. Nothing is written to the repository, and there is no path from here
     * that could — the only GitHub call involved is a GET.
     *
     * Visibility is attached when the App can see the repo and left absent when it cannot,
     * which is how a repo connected on a deployment with no GitHub App stays honestly
     * unlabelled instead of being guessed at.
     */
    async connectRepo(orgId: string, repo: string) {
      await requireOrg(orgId);
      const name = repo.trim();
      if (!REPO_SLUG.test(name)) {
        throw new ForbiddenError(
          `"${name}" is not an owner/name repository — for a directory on this host, run a scan`,
        );
      }
      requireRepoInScope(scope, name);
      if (!store.connectRepo) throw new Error("Store does not support connecting repositories");
      let meta: Awaited<ReturnType<RepoDirectory["getRepoMetadata"]>>;
      if (options.repoDirectory) {
        // A lookup failure must not block the connect — it only costs us the metadata.
        meta = await options.repoDirectory.getRepoMetadata(name).catch(() => undefined);
      }
      const record = await store.connectRepo(
        newRepoRecord(orgId, name, {
          source: "github",
          // Each spread is conditional on its own value, not on `meta` as a whole. GitHub can
          // answer without stating visibility, and writing an explicit `undefined` there would
          // record "we asked and it is nothing" where the truth is "we do not know" — the
          // distinction the whole absent-means-unknown rule rests on.
          ...(meta?.visibility ? { visibility: meta.visibility } : {}),
          ...(meta?.githubRepoId ? { githubRepoId: meta.githubRepoId } : {}),
          ...(meta?.defaultBranch ? { defaultBranch: meta.defaultBranch } : {}),
        }),
      );
      return toRepoView(record);
    },

    /**
     * PATCH /v1/orgs/:org/repos/:repo — per-repo settings.
     *
     * Specified in contracts/api.md since the first plan and unimplemented until now, which
     * is why the repos table labelled its gate column "default" and apologised in a footnote.
     * Only the three settings the contract names are writable; unknown keys are ignored
     * rather than merged, so a malformed body cannot widen what is persisted.
     *
     * `fail_closed` is accepted here because CLAUDE.md rule 4 makes it a per-repo opt-in — the
     * default stays `fail_open` and only an explicit request moves it.
     */
    async updateRepoSettings(orgId: string, repo: string, patch: Record<string, unknown>) {
      await requireOrg(orgId);
      requireRepoInScope(scope, repo);
      if (!store.updateRepo) throw new Error("Store does not support per-repository settings");
      const clean: RepoSettingsPatch = {};
      if (patch.gate_mode === "off" || patch.gate_mode === "block_verified" || patch.gate_mode === "block_threshold") {
        clean.gateMode = patch.gate_mode;
      }
      if (patch.gate_failure_mode === "fail_open" || patch.gate_failure_mode === "fail_closed") {
        clean.gateFailureMode = patch.gate_failure_mode;
      }
      if (typeof patch.agent_loop_enabled === "boolean") clean.agentLoopEnabled = patch.agent_loop_enabled;
      const next = await store.updateRepo(orgId, repo, clean);
      if (!next) throw new NotFoundError(`repository ${repo}`);
      return toRepoView(next);
    },

    /**
     * DELETE /v1/orgs/:org/repos/:repo — disconnect.
     *
     * Removes the repository from the org's inventory and nothing else. Scans and findings
     * already recorded are left alone: they are evidence of what was true at the time, and
     * disconnecting a repository is not a claim that its history did not happen.
     */
    async disconnectRepo(orgId: string, repo: string) {
      await requireOrg(orgId);
      requireRepoInScope(scope, repo);
      if (!store.deleteRepo) throw new Error("Store does not support disconnecting repositories");
      if (!(await store.deleteRepo(orgId, repo))) throw new NotFoundError(`repository ${repo}`);
      return { ok: true, disconnected: repo };
    },
  });

  return {
    ...build(undefined),

    /**
     * The same handlers, bound to one caller's repository access.
     *
     * The HTTP layer calls this once per request and uses the result for every route, so a
     * route added later is scoped without anyone remembering to scope it. That is the same
     * argument the route gate in server.ts makes for itself, and it is the reason the scope is
     * bound here rather than passed as an argument to forty handlers.
     *
     * `undefined` — no session, or a session this deployment has no GitHub grant for (an
     * allow-listed operator, a development sign-in) — yields no repository restriction, which
     * is the behaviour those deployments already had. What it must never yield is an *empty*
     * restriction, which would lock every one of them out of their own data.
     */
    async forSession(session: Session | null) {
      if (!session || !options.accessDirectory) return build(undefined);
      return build(await options.accessDirectory.scopeFor(session));
    },

    /** Every org this user may reach, newest resolution — for `/v1/auth/me` and org switching. */
    async orgsForUser(session: Session | null) {
      if (!session || !options.accessDirectory) return [];
      return options.accessDirectory.orgsFor(session.userId);
    },

    /**
     * Re-issue this session against another org the same user provably reaches.
     *
     * The check is against a *freshly read* grant, not against anything the caller sent: the
     * org id in the request is a request, and the grant is the answer. Without that, switching
     * orgs would be a self-service way to mint a session for any tenant whose id you could
     * guess — the exact hole that was closed when `authCallback` stopped taking `orgId` from
     * the request body.
     */
    async switchOrg(session: Session, orgId: string) {
      if (!sessionSecret) throw new NotConfiguredError("sessions are not configured on this deployment");
      const orgs = options.accessDirectory ? await options.accessDirectory.orgsFor(session.userId) : [];
      const target = orgs.find((o) => o.login.toLowerCase() === orgId.toLowerCase());
      if (!target) {
        throw new ForbiddenError(
          `you do not have access to "${orgId}". Gatepass shows the organizations your GitHub account ` +
            `can reach, and that is not one of them.`,
        );
      }
      await ensureOrgFor(target);
      const token = createSession(
        { userId: session.userId, login: session.login, orgId: target.login, role: target.role },
        sessionSecret,
      );
      return { token, orgId: target.login, role: target.role };
    },
  };
}

/**
 * Wire shape for a repository row.
 *
 * `visibility`, `frameworks`, `defaultBranch` and `lastScanId` are omitted rather than
 * defaulted when they are not known. An absent key and a wrong value are very different
 * things to a reader, and only one of them is honest.
 */
function toRepoView(r: RepoRecord) {
  return {
    name: r.name,
    source: r.source,
    ...(r.visibility ? { visibility: r.visibility } : {}),
    ...(r.defaultBranch ? { defaultBranch: r.defaultBranch } : {}),
    scanStatus: r.lastScanId ? ("complete" as const) : ("never_scanned" as const),
    gateMode: r.gateMode,
    gateFailureMode: r.gateFailureMode,
    agentLoopEnabled: r.agentLoopEnabled,
    frameworks: r.frameworks,
    ...(r.lastScanId ? { lastScanId: r.lastScanId } : {}),
    ...(r.lastScanAt ? { lastScanAt: r.lastScanAt } : {}),
    connectedAt: r.connectedAt,
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
