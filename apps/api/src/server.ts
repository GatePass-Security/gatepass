import http from "node:http";
import { URL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MemoryStore, type Store } from "./store.js";
import { makeHandlers, NotFoundError, ForbiddenError, NotConfiguredError, AuthFailedError } from "./handlers.js";
import { AccessDirectory, type AccessDirectoryOptions } from "./access.js";
import {
  AuthError,
  PasswordAttemptLimiter,
  authorizeAction,
  authorizeOrg,
  readAuth,
  requiredRole,
  resolveOrgId,
  type LocalUser,
} from "./auth.js";
import { RateLimiter, rateLimitHeaders } from "./rate-limit.js";
import { AdminTokenGuard, RunnerTokenRegistry, bearerToken, type RunnerTokenEntry } from "./tokens.js";
import { WebhookSignatureError, FixPullRequestError, type GitHubClient } from "@gatepass/github";
import { PlanTierError } from "@gatepass/shared";
import { RunnerUploadError } from "@gatepass/runner";

/**
 * Thin HTTP binding over the handlers. Minimal Node http server standing in for the
 * production Fastify app — it exists so the platform wiring is genuinely runnable end-to-end.
 * Routes mirror contracts/api.md.
 */

/** Path of a published-benchmark artifact (repo-root benchmark/published/). */
function resolvePublished(file: string): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "benchmark", "published", file);
}

export interface ServerOptions {
  store?: Store;
  githubClient?: GitHubClient;
  /**
   * Opt-in code-writing client for suggested-fix pull requests. Absent ⇒ this deployment
   * cannot write to a repository at all, and the fix-PR route says so plainly.
   */
  fixPrClient?: import("@gatepass/github").FixPullRequestClient;
  repoFetcher?: import("@gatepass/github").RepoFetcher;
  llmTransport?: import("@gatepass/semantic").LlmTransport;
  llmModel?: string;
  webhookSecret?: string;
  webhookOrgId?: string;
  vantaToken?: string;
  drataToken?: string;
  oauthConfig?: import("@gatepass/github").OAuthConfig;
  sessionSecret?: string;
  oauthFetch?: typeof fetch;
  /** Org a successful sign-in belongs to — configuration, never a request parameter. */
  sessionOrgId?: string;
  /** GitHub organization whose membership decides a signed-in user's role. */
  githubOrgLogin?: string;
  /** Explicit allow-list of GitHub logins for deployments with no org to check against. */
  allowedLogins?: readonly { login: string; role?: import("@gatepass/shared").Role }[];
  /** Role for an allow-listed user who did not name one. Defaults to `viewer`. */
  defaultRole?: import("@gatepass/shared").Role;
  /**
   * Local development sign-in. Refused outright when `NODE_ENV=production`, regardless of
   * what a caller passes here — see the `devAuth` line in `createServer`.
   */
  devAuth?: boolean;
  devOrgId?: string;
  /** Read-only GitHub repository discovery for the connect-a-repository flow. */
  repoDirectory?: import("@gatepass/github").RepoDirectory;
  /** Set to false to skip seeding demo benchmark data (production PgStore). */
  seedBenchmark?: boolean;
  /**
   * Org-scoped self-hosted runner tokens. Absent ⇒ `POST /v1/runner/results`
   * rejects every request (fail closed).
   */
  runnerTokens?: readonly RunnerTokenEntry[];
  /**
   * Operator credential for `POST /v1/benchmark/publish`. Absent ⇒ that route
   * rejects every request (fail closed).
   */
  adminToken?: string;
  /**
   * Derive tenancy and per-repository access from GitHub.
   *
   * Set ⇒ orgs are GitHub organizations that have installed the Gatepass App, a sign-in is
   * admitted by reaching at least one of them, and every repository-shaped read is narrowed to
   * what GitHub says the caller may see. Left unset ⇒ the older single-org posture, which is
   * what the test suite and local CLI use.
   */
  githubAccess?: AccessDirectoryOptions;
  /**
   * Local password accounts (`GATEPASS_LOCAL_USERS`). Empty ⇒ `POST /v1/auth/password` reports
   * itself unconfigured and no password will ever be accepted.
   */
  localUsers?: readonly LocalUser[];
  /** Whether the store already holds at least one local account, counted once at boot. */
  hasStoredAccounts?: boolean;
}

/**
 * The address a request came from, for the sign-in attempt limiter.
 *
 * `x-forwarded-for` is honoured because this runs behind a proxy in every real deployment, and
 * the *first* entry is taken — that is the client as the nearest trusted proxy saw it. A caller
 * can forge the header, which would only ever spread their own attempts across more buckets;
 * the per-login counter is the one that cannot be evaded that way, and both must pass.
 */
function clientAddress(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

export async function createServer(opts: ServerOptions = {}): Promise<{ server: http.Server; store: Store }> {
  const store = opts.store ?? new MemoryStore();
  const rateLimiter = new RateLimiter();
  const runnerTokens = new RunnerTokenRegistry(opts.runnerTokens ?? []);
  const adminGuard = new AdminTokenGuard(opts.adminToken);
  const passwordAttempts = new PasswordAttemptLimiter();
  /*
   * The development sign-in, resolved once at construction.
   *
   * Note the second condition: even a caller who passes `devAuth: true` outright gets false
   * on a production deployment. The flag is an opt-in, not an override — there must be no
   * argument anyone can pass that turns this on in production.
   */
  const devAuth = opts.devAuth === true && (process.env.NODE_ENV ?? "").trim().toLowerCase() !== "production";
  const accessDirectory = opts.githubAccess ? new AccessDirectory(store, opts.githubAccess) : undefined;
  const h = makeHandlers(store, {
    ...(accessDirectory ? { accessDirectory } : {}),
    githubClient: opts.githubClient,
    fixPrClient: opts.fixPrClient,
    repoFetcher: opts.repoFetcher,
    llmTransport: opts.llmTransport,
    llmModel: opts.llmModel,
    webhookSecret: opts.webhookSecret,
    webhookOrgId: opts.webhookOrgId,
    vantaToken: opts.vantaToken,
    drataToken: opts.drataToken,
    oauthConfig: opts.oauthConfig,
    sessionSecret: opts.sessionSecret,
    oauthFetch: opts.oauthFetch,
    sessionOrgId: opts.sessionOrgId,
    githubOrgLogin: opts.githubOrgLogin,
    allowedLogins: opts.allowedLogins,
    defaultRole: opts.defaultRole,
    devAuth,
    devOrgId: opts.devOrgId,
    repoDirectory: opts.repoDirectory,
    localUsers: opts.localUsers,
    hasStoredAccounts: opts.hasStoredAccounts,
  });

  // Seed demo orgs for integration tests and dev use
  await store.upsertOrg({
    id: "demo",
    planTier: "scale",
    llmEnabled: true,
    agentLoopEnabled: true,
    fixPrEnabled: true,
  });
  await store.upsertOrg({ id: "free-org", planTier: "free", llmEnabled: true, agentLoopEnabled: false });
  await store.upsertOrg({ id: "no-agent", planTier: "scale", llmEnabled: true, agentLoopEnabled: false });

  // Benchmark seed: ONLY real, published results (benchmark/published/*.json, generated by
  // `pnpm corpus:publish` from the actual corpus gate + incumbent runs). No fabricated numbers —
  // an empty benchmark page is honest; invented precision is not.
  if (store.publishBenchmark && opts.seedBenchmark !== false) {
    try {
      const artifactPath = resolvePublished("corpus-v1.json");
      const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
        corpusVersion: string;
        casesMeasured?: number;
        runs: { tool: string; perClass: unknown[] }[];
      };
      for (const run of artifact.runs) {
        await store.publishBenchmark(
          artifact.corpusVersion,
          run.tool,
          JSON.stringify({
            ...run,
            corpusVersion: artifact.corpusVersion,
            // Carried onto each run so a reader can state the corpus size. Dropped, the only
            // honest thing to say is "a small corpus" — true, but weaker than the number.
            ...(artifact.casesMeasured !== undefined ? { casesMeasured: artifact.casesMeasured } : {}),
            publishedAt: new Date().toISOString(),
          }),
        );
      }
    } catch {
      // No published artifact available (e.g. minimal checkout) — serve an empty benchmark.
    }
  }

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err) => sendError(res, err));
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Set CORS headers first so every response path (JSON, errors, 429, preflight) carries them.
    applyCors(req, res);
    const url = new URL(req.url ?? "/", "http://localhost");
    /*
     * Path segments are decoded AFTER splitting, so a percent-encoded value inside one
     * segment cannot invent a new segment.
     *
     * This was missing, and it broke a real button: the dashboard sends
     * `encodeURIComponent(fingerprint)`, every fingerprint starts `sha256:`, and the handler
     * was therefore looking up the literal `sha256%3A…`. Dispute answered 404 for every
     * finding on the page. The API's own tests never caught it because they interpolate the
     * raw fingerprint, where a `:` needs no escaping and passes straight through.
     */
    const p = url.pathname.split("/").filter(Boolean).map(decodeSegment);
    const q = url.searchParams;

    // Liveness probe & root status response.
    // `webAppUrl` comes from GATEPASS_WEB_URL; it was a hardcoded localhost, which a deployed
    // API would have handed to every caller as the address of the dashboard.
    if (url.pathname === "/" || url.pathname === "/healthz") {
      const webUrl = process.env.GATEPASS_WEB_URL?.replace(/\/+$/, "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          service: "Gatepass Security API Engine",
          ...(webUrl ? { webAppUrl: `${webUrl}/dashboard` } : {}),
          version: "1.0.0",
        }),
      );
      return;
    }

    const { raw: rawBody, json: body } = await readBody(req);
    const M = req.method;

    /*
     * Who is calling. A verified session decides the rate-limit bucket and the org; the
     * `X-Org-Id` header is now the last resort rather than the first, so a caller can no
     * longer mint a fresh bucket per request by varying a header they control
     * (contracts/api.md flagged exactly this).
     */
    const auth = await readAuth(req.headers, h.verifySessionToken, h.sessionsEnabled());
    /*
     * Every route below uses `hs` — the handlers bound to *this caller's* repository access.
     *
     * Bound once, here, for the same reason the org gate below is one gate rather than fifteen:
     * a route added later is scoped because it uses the same object, not because whoever added
     * it remembered to. `h` remains only for the three session-management calls that are about
     * the caller rather than about their data.
     */
    const hs = await h.forSession(auth.session);

    /*
     * Authorize against GitHub's current answer, not the role written into the token.
     *
     * A session token carries the role its holder had when they signed in, and it is good for
     * seven days. Somebody demoted from organization owner to member this morning would keep
     * changing gate policy, exporting evidence and opening fix pull requests until that token
     * expired — the dashboard would have re-read their access minutes later and still handed
     * them admin, because nothing consulted it.
     *
     * The live grant is already resolved for the repository scope, and `scopeFor` takes the
     * lower of the two roles. Applying it here is what makes the whole role hierarchy answer to
     * GitHub rather than to a claim the caller is carrying around.
     *
     * Only downward, and only when a grant exists. A *promotion* still waits for a new token,
     * which is the safe direction to be slow in; and a deployment with no GitHub-derived access
     * (an allow-listed operator, a development session) has no grant to consult and is
     * unchanged.
     */
    const live = hs.viewerScope();
    if (auth.session && live && live.role !== auth.session.role) {
      auth.session = { ...auth.session, role: live.role };
    }
    // Resolved here rather than inside `resolveOrgId` because the token registry lives out here.
    const runnerOrg =
      p[1] === "runner" ? runnerTokens.resolveOrg(bearerToken(req.headers["authorization"])) : undefined;
    const orgId = resolveOrgId(auth, req.headers, p, runnerOrg ?? undefined);
    const rl = rateLimiter.check(orgId);
    if (!rl.allowed) {
      res.writeHead(429, { "content-type": "application/json", ...rateLimitHeaders(rl) });
      res.end(JSON.stringify({ error: "rate limit exceeded", retryAfter: Math.ceil(rl.retryAfterMs / 1000) }));
      return;
    }

    // CORS preflight — allow-origin/vary are already set per-request by applyCors above.
    // `authorization` joins the allowed headers because sessions travel as a bearer token, and
    // DELETE because disconnecting a repository is one. allow-credentials stays unset: the
    // dashboard's session cookie lives on the *web* origin and is attached server-side, so
    // nothing here needs the browser to send credentials cross-origin. See apps/web/src/app/api/gp.
    if (M === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,authorization,x-org-id",
        "access-control-max-age": "86400",
      });
      res.end();
      return;
    }

    // --- Auth (FR-027) ---
    // GET /v1/auth/config — which sign-in doors this deployment has.
    if (M === "GET" && p[1] === "auth" && p[2] === "config") {
      return sendJson(res, 200, hs.authConfig());
    }
    /*
     * GET /v1/auth/github/login?state=
     *
     * Both refusals are answered here rather than left to `sendError`'s catch-all, which maps
     * an unrecognised throw to 500. A caller who forgot `state` made a request error, and a
     * deployment with no OAuth credentials is not broken — paging someone at 3am for either
     * would be the API lying about whose problem it is.
     */
    if (M === "GET" && p[1] === "auth" && p[2] === "github" && p[3] === "login") {
      const state = q.get("state") ?? "";
      if (!state) return sendJson(res, 400, { error: "missing OAuth state" });
      if (!hs.authConfig().github) return sendJson(res, 501, { error: "OAuth not configured" });
      return sendJson(res, 200, hs.authLoginUrl(state));
    }
    /*
     * POST /v1/auth/github/callback { code }
     *
     * `orgId` is deliberately NOT read from the body any more. It used to be, which meant a
     * caller who completed OAuth could name any org and be handed a valid session for it.
     * The org is server configuration now (`sessionOrgId`).
     */
    if (M === "POST" && p[1] === "auth" && p[2] === "github" && p[3] === "callback") {
      return sendJson(res, 200, await hs.authCallback(String(body.code)));
    }
    /*
     * POST /v1/auth/password { login, password } — the local door.
     *
     * Rate-limited on *failures*, by login and by source address independently, because the
     * general limiter buckets by org and an unauthenticated attempt has none — so password
     * guessing would share one bucket with every other anonymous request and the limit that
     * stopped the attacker would also stop everyone else.
     *
     * A locked-out attempt answers 429 before any password work happens, which also means a
     * flood cannot turn this route into a CPU exhaustion vector via scrypt.
     */
    if (M === "POST" && p[1] === "auth" && p[2] === "password") {
      const login = String(body.login ?? "");
      const gate = passwordAttempts.check(login, clientAddress(req));
      if (!gate.allowed) {
        res.writeHead(429, {
          "content-type": "application/json",
          "retry-after": String(Math.ceil(gate.retryAfterMs / 1000)),
        });
        res.end(
          JSON.stringify({
            error: "too many failed sign-in attempts; wait a few minutes and try again",
            retryAfter: Math.ceil(gate.retryAfterMs / 1000),
          }),
        );
        return;
      }
      try {
        const result = await h.passwordSignIn(login, String(body.password ?? ""));
        passwordAttempts.succeed(login, clientAddress(req));
        return sendJson(res, 200, result);
      } catch (err) {
        if (err instanceof AuthFailedError) passwordAttempts.fail(login, clientAddress(req));
        throw err;
      }
    }
    /*
     * POST /v1/auth/github/link { code } — attach GitHub to the session making this request.
     *
     * Requires a session, and takes the account to link from *that session* rather than from the
     * body. A route that took a user id would let anyone who completed OAuth graft their GitHub
     * access onto somebody else's account, which is the same class of hole as `authCallback`
     * once taking `orgId` from the request.
     */
    if (M === "POST" && p[1] === "auth" && p[2] === "github" && p[3] === "link") {
      if (!auth.session) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "sign in before connecting a GitHub account" }));
        return;
      }
      return sendJson(res, 200, await h.linkGitHub(auth.session, String(body.code ?? "")));
    }
    // POST /v1/auth/dev-session { login? } — local development only (see handlers.devSession).
    if (M === "POST" && p[1] === "auth" && p[2] === "dev-session") {
      return sendJson(res, 200, hs.devSession(body.login ? String(body.login) : undefined));
    }
    /*
     * GET /v1/auth/me  (Authorization: Bearer <session>)
     *
     * The session claims, plus every org this GitHub account reaches. The org list comes from
     * the live grant rather than from the token, so an org somebody was added to this morning
     * shows up without them signing in again — and one they were removed from disappears.
     */
    if (M === "GET" && p[1] === "auth" && p[2] === "me") {
      if (!auth.session) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not authenticated" }));
        return;
      }
      const orgs = await h.orgsForUser(auth.session);
      return sendJson(res, 200, {
        ...auth.session,
        orgs: orgs.map((o) => ({
          id: o.login,
          role: o.role,
          repoCount: o.repos.length,
          member: o.member,
          accessGranularity: o.granularity,
        })),
      });
    }
    /*
     * POST /v1/auth/switch-org { orgId } — move this session to another org the same account
     * reaches, returning a fresh token. Verified against a freshly read grant, never against
     * the request: the org id here is a request, and GitHub's answer is the authority.
     */
    if (M === "POST" && p[1] === "auth" && p[2] === "switch-org") {
      if (!auth.session) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not authenticated" }));
        return;
      }
      return sendJson(res, 200, await h.switchOrg(auth.session, String(body.orgId ?? "")));
    }
    /*
     * POST /v1/auth/signout — withdraw the token that made this request.
     *
     * Deliberately not gated on `auth.session`: this is what you call when you believe a token
     * has escaped, and refusing to revoke an already-revoked one would just be noise. It reads
     * the raw header rather than `auth.session` for the same reason.
     */
    if (M === "POST" && p[1] === "auth" && p[2] === "signout") {
      return sendJson(res, 200, await hs.signOut(bearerToken(req.headers["authorization"])));
    }

    /*
     * --- Org authorization, once, ahead of every org-scoped route ---
     *
     * This router has no middleware chain, so the alternative was a guard copied into ~15
     * route bodies — which is how routes end up shipping ungated. One gate here, driven by
     * the table in auth.ts, covers every `/v1/orgs/:org/...` path including any added later.
     *
     * `authorizeOrg` is a no-op for a deployment with no session secret, so the CLI and curl
     * workflows this API also serves are untouched.
     */
    if (p[1] === "orgs" && p[2]) {
      authorizeOrg(auth, p[2], requiredRole(M, p));
    }
    /*
     * `/v1/scans/:id/...` names a scan, not a tenant — so the org has to come from the record.
     *
     * Without this a session for org A could read org B's findings, SARIF and gate decision by
     * scan id: `authorizeOrg` only fires on paths with an `orgs` segment, and these have none.
     * Scan ids are UUIDs so they are not enumerable, but "unguessable" is not an access
     * control, and a scan id travels in links, logs and PR comments.
     *
     * `POST .../gate` is additionally a write, so it takes the member role like the other two
     * record-addressed writes below.
     */
    if (p[1] === "scans" && p[2]) {
      // Reads included: `authorizeAction` with no minimum still demands a session wherever
      // sessions exist, so a scan id alone stops being enough to read findings or SARIF.
      authorizeAction(auth, M === "POST" && p[3] === "gate" ? "member" : undefined);
      if (auth.session) {
        const scan = await store.getScan(p[2]);
        if (scan && scan.orgId !== auth.session.orgId) {
          throw new AuthError(`scan ${p[2]} does not belong to org "${auth.session.orgId}"`, 403);
        }
      }
    }
    // The two writes that name a finding or a fleet server rather than an org.
    if (M === "POST" && ((p[1] === "findings" && p[3] === "dispute") || (p[1] === "fleet" && p[4] === "rescan"))) {
      authorizeAction(auth, "member");
    }

    // POST /v1/webhooks/github  — GitHub webhook receiver (raw body, HMAC-verified)
    if (M === "POST" && p[0] === "v1" && p[1] === "webhooks" && p[2] === "github") {
      return sendJson(res, 202, await hs.handleWebhook(rawBody, req.headers as never));
    }
    // POST /v1/orgs/:org/scan-remote { repo, ref }  — clone-and-scan a real GitHub repo
    if (M === "POST" && p[0] === "v1" && p[1] === "orgs" && p[3] === "scan-remote") {
      return sendJson(
        res,
        201,
        await hs.scanRemoteRepo(p[2]!, String(body.repo), body.ref ? String(body.ref) : undefined),
      );
    }
    // POST /v1/orgs/:org/scans
    // `!p[4]` matters: without it this also matches POST /orgs/:org/scans/:id/<anything>,
    // swallowing every per-scan sub-route below and answering it as "create a scan" with an
    // undefined path. The GET beside it has always been exact; this one was not.
    if (M === "POST" && p[0] === "v1" && p[1] === "orgs" && p[3] === "scans" && !p[4]) {
      sendJson(res, 201, await hs.createScan(p[2]!, String(body.path)));
      return;
    }
    // GET /v1/orgs/:org/scans — scan history summaries (dashboard overview)
    if (M === "GET" && p[1] === "orgs" && p[3] === "scans" && !p[4]) {
      return sendJson(res, 200, await hs.listScans(p[2]!));
    }
    // GET /v1/scans/:id/findings[?includeSuppressed=1]
    if (M === "GET" && p[1] === "scans" && p[3] === "findings") {
      return sendJson(res, 200, await hs.getFindings(auth.session?.orgId, p[2]!, q.get("includeSuppressed") === "1"));
    }
    if (M === "GET" && p[1] === "scans" && p[3] === "findings.sarif") {
      return sendJson(res, 200, await hs.getSarif(auth.session?.orgId, p[2]!));
    }
    // POST /v1/scans/:id/gate
    if (M === "POST" && p[1] === "scans" && p[3] === "gate") {
      return sendJson(res, 200, await hs.evaluateGate(auth.session?.orgId, p[2]!, body as never));
    }
    // GET /v1/orgs/:org/scans/:id/agent-guidance?fingerprint=
    if (M === "GET" && p[1] === "orgs" && p[3] === "scans" && p[5] === "agent-guidance") {
      return sendJson(res, 200, await hs.agentGuidance(p[2]!, p[4]!, q.get("fingerprint") ?? ""));
    }
    /*
     * POST /v1/orgs/:org/scans/:id/fix-pr { fingerprints?, repo?, base?, requestedBy? }
     *
     * The explicit human trigger for a suggested-fix pull request (Principle III). There is
     * deliberately no GET, no webhook branch, and no scheduled path that reaches this — a
     * repository write happens because a person asked for it, once, or it does not happen.
     */
    if (M === "POST" && p[1] === "orgs" && p[3] === "scans" && p[5] === "fix-pr") {
      return sendJson(
        res,
        201,
        await hs.openFixPullRequest(p[2]!, p[4]!, {
          fingerprints: Array.isArray(body.fingerprints) ? body.fingerprints.map(String) : undefined,
          repo: body.repo ? String(body.repo) : undefined,
          base: body.base ? String(body.base) : undefined,
          requestedBy: body.requestedBy ? String(body.requestedBy) : undefined,
        }),
      );
    }
    // POST /v1/findings/:fingerprint/dispute { scanId, reason }
    if (M === "POST" && p[1] === "findings" && p[3] === "dispute") {
      return sendJson(res, 200, await hs.disputeFinding(p[2]!, String(body.scanId), String(body.reason)));
    }
    // GET /v1/orgs/:org/evidence?scanId=
    if (M === "GET" && p[1] === "orgs" && p[3] === "evidence" && p[4] !== "export") {
      return sendJson(res, 200, await hs.getEvidence(p[2]!, q.get("scanId") ?? ""));
    }
    // POST /v1/orgs/:org/evidence/export { scanId, platform }  — push to Vanta/Drata
    if (M === "POST" && p[1] === "orgs" && p[3] === "evidence" && p[4] === "export") {
      return sendJson(
        res,
        200,
        await hs.exportEvidence(p[2]!, String(body.scanId), (body.platform as never) ?? "vanta"),
      );
    }
    // POST /v1/orgs/:org/questionnaires { scanId, format, content }
    if (M === "POST" && p[1] === "orgs" && p[3] === "questionnaires") {
      return sendJson(
        res,
        200,
        await hs.draftQuestionnaire(p[2]!, String(body.scanId), (body.format as never) ?? "csv", String(body.content)),
      );
    }
    // POST /v1/orgs/:org/fleet/servers { name, endpointOrRepo, configHash }
    if (M === "POST" && p[1] === "orgs" && p[3] === "fleet" && p[4] === "servers") {
      return sendJson(
        res,
        201,
        await hs.registerFleetServer(
          p[2]!,
          String(body.name),
          String(body.endpointOrRepo),
          String(body.configHash ?? ""),
        ),
      );
    }
    // GET /v1/orgs/:org/fleet
    if (M === "GET" && p[1] === "orgs" && p[3] === "fleet" && p.length === 4) {
      return sendJson(res, 200, await hs.fleetView(p[2]!));
    }
    // POST /v1/fleet/servers/:id/rescan { path }
    if (M === "POST" && p[1] === "fleet" && p[2] === "servers" && p[4] === "rescan") {
      return sendJson(res, 200, await hs.scanFleetServer(p[3]!, String(body.path)));
    }
    /*
     * POST /v1/runner/results — org-scoped runner token required.
     *
     * The target org comes from the TOKEN, never from the payload. It used to
     * come from `body.orgId`, which let any caller name any org and inject
     * findings into its scan history. A payload that names a different org is
     * rejected rather than quietly redirected, so a misconfigured runner fails
     * loudly instead of writing somewhere unexpected.
     */
    if (M === "POST" && p[1] === "runner" && p[2] === "results") {
      const tokenOrg = runnerTokens.resolveOrg(bearerToken(req.headers["authorization"]));
      if (!tokenOrg) {
        return sendJson(res, 401, {
          error: runnerTokens.configured
            ? "invalid or missing runner token"
            : "runner uploads are not enabled on this deployment (no runner tokens configured)",
        });
      }
      const claimed = body.orgId ?? q.get("orgId");
      if (claimed && String(claimed) !== tokenOrg) {
        return sendJson(res, 403, { error: "runner token is not scoped to the requested org" });
      }
      return sendJson(res, 201, await hs.ingestRunnerResults(tokenOrg, body.document ?? body));
    }
    /*
     * POST /v1/benchmark/publish — operator credential required. Published
     * precision figures are the product's public credibility claim, so this is
     * not a route that may accept anonymous writes.
     */
    if (M === "POST" && p[1] === "benchmark" && p[2] === "publish") {
      if (!adminGuard.accepts(bearerToken(req.headers["authorization"]))) {
        return sendJson(res, 401, {
          error: adminGuard.configured
            ? "invalid or missing admin token"
            : "benchmark publishing is not enabled on this deployment (no admin token configured)",
        });
      }
      return sendJson(
        res,
        201,
        await hs.publishBenchmark(
          String(body.tool),
          String(body.corpusVersion),
          body.labels as never,
          body.detections as never,
        ),
      );
    }
    // GET /v1/public/benchmark[/:corpusVersion]
    if (M === "GET" && p[1] === "public" && p[2] === "benchmark") {
      return sendJson(res, 200, await hs.getPublicBenchmark(p[3]));
    }
    // GET /v1/orgs/:org
    if (M === "GET" && p[1] === "orgs" && p.length === 3) {
      return sendJson(res, 200, await hs.getOrg(p[2]!));
    }
    /*
     * --- Repositories ---
     *
     * `:repo` is one **URL-encoded** path segment, because a repository name contains a slash
     * (`owner/name`) and a local-path scan target is an absolute path. `%2F` survives
     * `URL.pathname`, so the segment round-trips through `decodeURIComponent` intact.
     */
    // GET /v1/orgs/:org/repos/available — installation repos not yet connected (read-only).
    if (M === "GET" && p[1] === "orgs" && p[3] === "repos" && p[4] === "available") {
      return sendJson(res, 200, await hs.listAvailableRepos(p[2]!));
    }
    // GET /v1/orgs/:org/repos
    if (M === "GET" && p[1] === "orgs" && p.length === 4 && p[3] === "repos") {
      return sendJson(res, 200, await hs.listRepos(p[2]!));
    }
    // POST /v1/orgs/:org/repos { repo } — connect a repository (a GitHub read plus a row).
    if (M === "POST" && p[1] === "orgs" && p.length === 4 && p[3] === "repos") {
      return sendJson(res, 201, await hs.connectRepo(p[2]!, String(body.repo ?? "")));
    }
    /*
     * PATCH /v1/orgs/:org/repos/:repo { gate_mode?, gate_failure_mode?, agent_loop_enabled? }
     *
     * `p[4]` is already decoded — every segment is, once, at the top of `handle`. These two
     * routes briefly decoded it a second time, which silently rewrote any name containing a
     * literal `%`: a scan of a directory called `my%20proj` stores that exact name, and a
     * correctly-encoded `…%2Fmy%2520proj` then addressed `…/my proj` instead. The repository
     * became impossible to configure or disconnect, and in the worst case the second decode
     * would land on a different record. Scan targets are arbitrary caller-supplied paths, so
     * this was reachable rather than theoretical.
     */
    if (M === "PATCH" && p[1] === "orgs" && p[3] === "repos" && p[4]) {
      return sendJson(res, 200, await hs.updateRepoSettings(p[2]!, p[4], body as Record<string, unknown>));
    }
    // DELETE /v1/orgs/:org/repos/:repo — disconnect. Scans and findings are left alone.
    if (M === "DELETE" && p[1] === "orgs" && p[3] === "repos" && p[4]) {
      return sendJson(res, 200, await hs.disconnectRepo(p[2]!, p[4]));
    }
    // PATCH /v1/orgs/:org/settings { llm_analysis_enabled?, agent_loop_enabled? }
    // The OPTIONS preflight above has always advertised PATCH; this is the route
    // that makes it true. Returns the updated org record.
    if (M === "PATCH" && p[1] === "orgs" && p.length === 4 && p[3] === "settings") {
      return sendJson(res, 200, await hs.updateOrgSettings(p[2]!, body as Record<string, unknown>));
    }
    // POST /v1/orgs/:org/compliance/scan { repoPath } — run compliance scan
    if (M === "POST" && p[1] === "orgs" && p[3] === "compliance" && p[4] === "scan") {
      return sendJson(res, 201, await hs.complianceScan(p[2]!, String(body.repoPath)));
    }
    // GET /v1/orgs/:org/compliance/results/:scanId — get compliance scan results
    if (M === "GET" && p[1] === "orgs" && p[3] === "compliance" && p[4] === "results") {
      return sendJson(res, 200, await hs.complianceResult(p[2]!, p[5]!));
    }
    sendJson(res, 404, { error: "not found" });
  }

  return { server, store };
}

/**
 * CORS origin allow-list, driven by GATEPASS_ALLOWED_ORIGINS (comma-separated). Defaults to the
 * dashboard's dev origin. A security product must not ship a wildcard CORS API, so the allowed
 * origin is always drawn from this explicit list — never a blanket allow-all.
 */
function allowedOrigins(): string[] {
  const raw = process.env.GATEPASS_ALLOWED_ORIGINS;
  if (raw && raw.trim()) {
    return raw
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }
  return ["http://localhost:3001"];
}

/**
 * Apply CORS response headers for this request. The request Origin is echoed back only when it
 * is present in the allow-list; otherwise no allow-origin header is sent. Always varies on the
 * Origin header so shared caches never serve one origin's allowed response to another. Note:
 * allow-credentials is intentionally never set — a reflected-yet-allow-listed origin stays safe.
 */
function applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.setHeader("vary", "Origin");
  const requestOrigin = req.headers.origin;
  if (typeof requestOrigin === "string" && allowedOrigins().includes(requestOrigin)) {
    res.setHeader("access-control-allow-origin", requestOrigin);
  }
}

/** Decode one path segment, leaving a malformed escape sequence as-is rather than throwing. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  // The allow-origin header (if the request Origin is allow-listed) is set per-request by applyCors.
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendError(res: http.ServerResponse, err: unknown): void {
  if (err instanceof AuthError) return sendJson(res, err.status, { error: err.message });
  // 401, not 403: a failed password means we do not know who this is, and 403 would be a claim
  // that we do — which is a hint worth withholding from somebody guessing.
  if (err instanceof AuthFailedError) return sendJson(res, 401, { error: err.message });
  if (err instanceof NotFoundError) return sendJson(res, 404, { error: err.message });
  if (err instanceof ForbiddenError || err instanceof PlanTierError || err instanceof WebhookSignatureError)
    return sendJson(res, 403, { error: (err as Error).message });
  if (err instanceof RunnerUploadError) return sendJson(res, 422, { error: err.message });
  // Not configured is not broken. 501 keeps it out of the 5xx-means-page-someone bucket.
  if (err instanceof NotConfiguredError) return sendJson(res, 501, { error: err.message });
  // A refused fix PR is a statement about the request (no applicable fix, branch taken, no
  // remote), not a server fault. 500 would tell the dashboard to offer "try again", which is
  // exactly the wrong advice for every one of those cases.
  if (err instanceof FixPullRequestError) return sendJson(res, 422, { error: err.message });
  sendJson(res, 500, { error: (err as Error).message });
}

/** Methods that carry a request body. PATCH is included because the org-settings
 *  route needs one — while this only read POST, PATCH handlers silently received
 *  `{}` and every partial update was a no-op that still answered 200. */
const BODY_METHODS = new Set(["POST", "PATCH"]);

async function readBody(req: http.IncomingMessage): Promise<{ raw: string; json: Record<string, unknown> }> {
  if (!BODY_METHODS.has(req.method ?? "")) return { raw: "", json: {} };
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return { raw: "", json: {} };
  try {
    return { raw, json: JSON.parse(raw) };
  } catch {
    return { raw, json: {} };
  }
}
