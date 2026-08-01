import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "./server.js";
import { makeHandlers } from "./handlers.js";
import { MemoryStore, type Store } from "./store.js";
import { parseRunnerTokens } from "./tokens.js";
import { parseAllowedLogins, parseLocalUsers } from "./auth.js";
import { devAuthEnabled } from "./auth.js";
import { PgStore, createMongoStore, loadConfig, loadDotEnv, type Role } from "@gatepass/shared";
import {
  createRepoDirectory,
  getInstallationToken,
  RestGitHubClient,
  TarballRepoFetcher,
  githubTarballDownloader,
  publicTarballDownloader,
} from "@gatepass/github";
import { createNimTransport, DEFAULT_MODEL } from "@gatepass/semantic";

export { createServer } from "./server.js";
export { makeHandlers };
export { MemoryStore } from "./store.js";

const ROLES = new Set(["admin", "member", "viewer"]);

/** An explicit off switch. Anything else — including unset — leaves the feature at its default. */
function isOff(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

/**
 * Boot the API from the environment.
 *
 * Exported so `dev.ts` can start the same server with the local development sign-in turned
 * on, rather than duplicating this wiring or shipping a shell-specific `VAR=1 tsx` script
 * that only works on one platform.
 */
export async function startServer(): Promise<void> {
  // Dev convenience: pick up .env from the cwd or the repo root. Real env vars always win.
  loadDotEnv(".env");
  loadDotEnv(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env"));
  const config = loadConfig();
  const dbUrl = config.databaseUrl ?? process.env.DATABASE_URL;
  const mongoUri = process.env.MONGODB_URI?.trim();

  /*
   * Which datastore, and what happens when the configured one is unreachable.
   *
   * MongoDB first when `MONGODB_URI` is set, then Postgres, then memory. A deployment that
   * configures neither runs in memory and says so — that is the local-development posture, and
   * it is honest about losing everything on restart.
   *
   * A configured store that fails to connect **stops the process**. Falling back to memory
   * would be the worst of the three outcomes: the API would come up, answer every request, and
   * silently write a customer's scan history into a Map that dies with the process. A refusal
   * to start is loud, immediate, and points at the actual problem.
   */
  let store: Store;
  let storeLabel: string;
  let closeStore: (() => Promise<void>) | undefined;

  if (mongoUri) {
    try {
      const conn = await createMongoStore(mongoUri, process.env.MONGODB_DB);
      store = conn.store;
      closeStore = conn.close;
      storeLabel = "mongodb";
    } catch (err) {
      console.error(`Could not connect to MongoDB: ${(err as Error).message}`);
      console.error(
        "The API will not start with a datastore it cannot reach. Check MONGODB_URI, the database " +
          "user's password, and that this machine's IP is on the Atlas access list (Network Access).",
      );
      process.exit(1);
    }
  } else if (dbUrl) {
    store = new PgStore(dbUrl);
    storeLabel = "postgres";
  } else {
    store = new MemoryStore();
    storeLabel = "memory";
  }

  const appId = process.env.GITHUB_APP_ID;
  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  // PaaS-friendly: the key can be provided as raw PEM content (e.g. Render/Railway env var)
  // instead of a file path. Content wins when both are set.
  const keyContent = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_INSTALLATION_ID;
  let githubClient = undefined;
  let repoFetcher = undefined;
  let repoDirectory = undefined;
  let installationToken = undefined;
  let appCredentialError = undefined;
  if (appId && (keyContent || keyPath) && installationId) {
    /*
     * Guarded, because this was the one optional integration that could kill the process.
     *
     * Getting here reads a file, parses a PEM and calls GitHub, and a deployment whose key was
     * mangled on the way into an environment variable — the ordinary failure, a PEM being
     * multi-line and an environment variable not — threw out of `startServer` before `listen`
     * ever ran. A hosting platform sees a service that opens no port and restarts it forever,
     * so a mistyped optional credential presented as total outage.
     *
     * Falling through is not a loosening of access. The anonymous fetcher below reaches strictly
     * less than the App does, so the cost of a bad credential is the deployment's private
     * repositories, not the deployment.
     */
    try {
      const privateKey = keyContent ?? readFileSync(resolve(keyPath!), "utf-8");
      const appConfig = { appId, privateKey, installationId };
      const { token } = await getInstallationToken(appConfig);
      installationToken = token;
      githubClient = new RestGitHubClient(token);
      // Clone-and-scan: fetch real repos as tarballs with the installation token.
      repoFetcher = new TarballRepoFetcher(githubTarballDownloader(appConfig));
      // Read-only repository discovery for the connect flow — two GETs, no write surface.
      repoDirectory = createRepoDirectory(token);
      console.log(`GitHub App client + repo fetcher + repo directory ready (installation ${installationId})`);
    } catch (err) {
      // All four together, or none: a half-configured client would fail later, further from the
      // cause, on whichever call happened to need the piece that never got built.
      installationToken = undefined;
      githubClient = undefined;
      repoFetcher = undefined;
      repoDirectory = undefined;
      appCredentialError = (err as Error).message;
    }
  }
  if (!repoFetcher) {
    /*
     * No App credentials — clone-and-scan still works, for public repositories only.
     *
     * The alternative was leaving `repoFetcher` undefined, which made every remote scan fail
     * with "no repo fetcher configured" and reduced a deployment without credentials to a
     * local-directory linter. Anonymous fetching claims no access it has not been granted:
     * GitHub returns exactly what it returns to anyone, so this widens what can be scanned
     * without widening what can be reached.
     */
    repoFetcher = new TarballRepoFetcher(publicTarballDownloader());
    if (appCredentialError !== undefined) {
      // stderr, and stated as a rejection rather than an absence: this deployment was configured
      // to use an App and is not using one, which is a different situation from never having
      // asked for it, and the operator has something to fix.
      console.error(`GitHub App credentials REJECTED — ${appCredentialError}`);
      console.error("  Running without the App: clone-and-scan is limited to public repositories.");
    } else {
      console.log("No GitHub App configured — clone-and-scan is limited to public repositories.");
    }
  }

  const llmTransport = config.nvidiaApiKey ? createNimTransport({ apiKey: config.nvidiaApiKey }) : undefined;
  if (llmTransport) {
    console.log(`LLM transport ready (NVIDIA NIM, model ${DEFAULT_MODEL})`);
  }

  /*
   * Write credentials for the two non-browser endpoints. Both fail closed, so
   * the log line below is the operator's confirmation that they are on — an
   * absent line means those routes are rejecting everything, which is the
   * intended posture for a deployment that does not use them.
   */
  const runnerTokens = parseRunnerTokens(process.env.GATEPASS_RUNNER_TOKENS);
  console.log(
    runnerTokens.length > 0
      ? `Runner uploads enabled for ${runnerTokens.length} org token(s)`
      : "Runner uploads DISABLED (set GATEPASS_RUNNER_TOKENS='org:token,…' to enable)",
  );
  console.log(
    process.env.GATEPASS_ADMIN_TOKEN?.trim()
      ? "Benchmark publishing enabled (admin token configured)"
      : "Benchmark publishing DISABLED (set GATEPASS_ADMIN_TOKEN to enable)",
  );

  /*
   * Sign-in wiring.
   *
   * `devAuth` is the local development door. It needs an explicit `GATEPASS_DEV_AUTH=1` AND a
   * non-production `NODE_ENV` (see auth.ts), so it is off by default everywhere and cannot be
   * switched on in production at all. `pnpm --filter @gatepass/api dev` sets the flag;
   * `start` — which is what render.yaml runs — does not.
   *
   * `defaultRole` is what an allow-listed user gets when their entry does not name a role. It
   * defaults to `viewer` rather than `member`: a deployment that has not told us how to tell an
   * owner from a stranger should hand out read-only sessions.
   */
  const devAuth = devAuthEnabled();
  const rawDefaultRole = process.env.GATEPASS_DEFAULT_ROLE?.trim().toLowerCase();
  const defaultRole = rawDefaultRole && ROLES.has(rawDefaultRole) ? (rawDefaultRole as Role) : undefined;
  const oauthReady = Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET);
  const allowedLogins = parseAllowedLogins(process.env.GATEPASS_ALLOWED_LOGINS);
  const githubOrg = process.env.GATEPASS_GITHUB_ORG;
  // How long a cached access grant stays authoritative. Minutes, because a cached grant is
  // precisely access GitHub may already have taken away.
  const rawTtl = Number(process.env.GATEPASS_ACCESS_TTL_SEC);
  const accessTtlSec = Number.isFinite(rawTtl) && rawTtl > 0 ? rawTtl : undefined;
  const localUsers = parseLocalUsers(process.env.GATEPASS_LOCAL_USERS);
  /*
   * Who may sign in and what they will see, stated at boot.
   *
   * The lines below matter because OAuth admits every GitHub account on earth by itself — the
   * admission rule is the only thing narrowing that, and an operator should be able to read
   * which one is in force without opening the code. A deployment with credentials but no
   * admission rule is announced as refusing everyone, because it does.
   *
   * GitHub-derived access: tenants are GitHub orgs, and each person sees exactly the
   * repositories GitHub says they may work on.
   *
   * On by default whenever sign-in works, because it is the product's access model and not an
   * add-on. `GATEPASS_GITHUB_ACCESS=0` turns it off for a deployment that genuinely wants the
   * older single-org posture — a local install, an air-gapped evaluation — and the boot line
   * below says which one is in force so nobody has to guess from behaviour.
   *
   * `GATEPASS_GITHUB_ORG`, when set, keeps a multi-tenant-capable build serving exactly one
   * tenant: a user who reaches five installations still only gets the one this deployment is
   * for.
   */
  const githubAccessEnabled =
    oauthReady && Boolean(process.env.SESSION_SECRET) && !isOff(process.env.GATEPASS_GITHUB_ACCESS);
  const githubAccess = githubAccessEnabled
    ? {
        ...(installationToken ? { installationToken } : {}),
        ...(githubOrg ? { orgAllowList: [githubOrg.toLowerCase()] } : {}),
        ...(accessTtlSec !== undefined ? { ttlSec: accessTtlSec } : {}),
      }
    : undefined;

  if (!oauthReady || !process.env.SESSION_SECRET) {
    console.log("GitHub sign-in DISABLED (set GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET and SESSION_SECRET)");
  } else if (githubAccess) {
    console.log(
      githubOrg
        ? `GitHub-derived access ON, restricted to the "${githubOrg}" organization — each user sees only the repositories GitHub grants them`
        : "GitHub-derived access ON — tenants are GitHub orgs with the Gatepass App installed; each user sees only the repositories GitHub grants them",
    );
    if (!installationToken) {
      console.warn(
        "  No GitHub App installation token (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_INSTALLATION_ID). " +
          "Per-repository access still works for GitHub App sign-ins; a classic OAuth App sign-in falls back to " +
          "organization-wide access, which is coarser. /v1/auth/me reports which, per org, as accessGranularity.",
      );
    }
  } else if (githubOrg || allowedLogins.length > 0) {
    const rules = [
      ...(githubOrg ? [`active members of the "${githubOrg}" GitHub org`] : []),
      ...(allowedLogins.length > 0 ? [`${allowedLogins.length} allow-listed login(s)`] : []),
    ];
    console.log(`GitHub sign-in enabled for ${rules.join(" and ")}; everyone else is refused a session`);
  } else {
    console.warn(
      "GitHub sign-in has credentials but NO ADMISSION RULE, so every sign-in is refused. " +
        "Set GATEPASS_GITHUB_ORG to a GitHub organization, or GATEPASS_ALLOWED_LOGINS='login,login:admin'.",
    );
  }
  /*
   * The local password door, announced loudly because it is a shared credential by design.
   *
   * Nothing about it is subtle: anyone holding the password is inside, there is no second
   * factor, and it does not expire when somebody leaves. That is an acceptable trade for
   * handing a reviewer a look at a deployment and a bad one for anything else, so the log says
   * which accounts exist and at what role rather than leaving an operator to discover it.
   */
  /*
   * Seed the environment's accounts into the store.
   *
   * This is what makes `GATEPASS_LOCAL_USERS` a bootstrap rather than the permanent home: the
   * first boot writes them, and after that the database holds them and can hold others that
   * were never in an environment variable. Rotating still works the way an operator expects,
   * because sign-in reads the environment *first* for a login it names — see `passwordSignIn`.
   */
  let storedAccountCount = 0;
  if (store.putLocalAccount && store.listLocalAccounts) {
    for (const u of localUsers) {
      await store.putLocalAccount({ login: u.login, passwordHash: u.passwordHash, role: u.role });
    }
    storedAccountCount = (await store.listLocalAccounts()).length;
  }

  if (localUsers.length > 0 || storedAccountCount > 0) {
    const summary =
      localUsers.length > 0
        ? localUsers.map((u) => `${u.login} (${u.role})`).join(", ")
        : `${storedAccountCount} account(s) from the database`;
    console.warn(
      `PASSWORD SIGN-IN ENABLED for ${summary}. These are shared credentials with no second factor — ` +
        `rotate them when whoever you gave them to is done, by regenerating GATEPASS_LOCAL_USERS ` +
        `(pnpm --filter @gatepass/api hash-password <login> <role>).`,
    );
    if (!process.env.SESSION_SECRET) {
      console.warn("  …but SESSION_SECRET is unset, so no session can be issued and the door stays shut.");
    }
  }
  if (devAuth) {
    console.warn(
      "DEV SIGN-IN ENABLED — POST /v1/auth/dev-session issues an admin session to anyone who asks. " +
        "This is refused when NODE_ENV=production. Never set GATEPASS_DEV_AUTH on a deployment.",
    );
  }

  const { server } = await createServer({
    store,
    githubClient,
    repoFetcher,
    repoDirectory,
    llmTransport,
    llmModel: DEFAULT_MODEL,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    webhookOrgId: process.env.GATEPASS_WEBHOOK_ORG,
    vantaToken: process.env.VANTA_API_TOKEN,
    drataToken: process.env.DRATA_API_TOKEN,
    oauthConfig:
      process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET
        ? {
            clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
            clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
            redirectUri: process.env.GITHUB_OAUTH_REDIRECT_URI,
          }
        : undefined,
    sessionSecret: process.env.SESSION_SECRET,
    sessionOrgId: process.env.GATEPASS_SESSION_ORG,
    githubOrgLogin: process.env.GATEPASS_GITHUB_ORG,
    allowedLogins: parseAllowedLogins(process.env.GATEPASS_ALLOWED_LOGINS),
    defaultRole,
    devAuth,
    devOrgId: process.env.GATEPASS_SESSION_ORG,
    runnerTokens,
    adminToken: process.env.GATEPASS_ADMIN_TOKEN,
    localUsers,
    hasStoredAccounts: storedAccountCount > 0,
    ...(githubAccess ? { githubAccess } : {}),
  });
  if (process.env.GITHUB_WEBHOOK_SECRET) {
    console.log("GitHub webhook receiver ready at POST /v1/webhooks/github");
  }

  /*
   * Seed real scans so an empty deployment has something genuine to show.
   *
   * These are **public GitHub repositories fetched over the network**, not the bundled fixture.
   * Both produce real findings from real code, so this is not about authenticity — it is about
   * what the result can be checked against. A finding on `owner/repo` at a named commit is one
   * anybody can open on github.com and confirm in ten seconds; a finding on a fixture this
   * project wrote is worth exactly as much as the fixture, and one reported against
   * `/Users/<somebody>/...` cannot be checked at all while also disclosing the host's layout.
   *
   * Several rather than one, and deliberately including repositories that come back **clean**.
   * A scanner is judged on both halves and the corpus can only ever show one of them: it is
   * built from planted vulnerabilities, so it measures whether Gatepass finds what is there and
   * says nothing about how it behaves on ordinary well-maintained code. Well-kept repositories
   * returning no findings is the precision claim demonstrated on code nobody here controls —
   * and it is the half an evaluator has most reason to doubt, because a noisy scanner is why
   * their team turned the last one off.
   *
   * This also exercises the path that matters: fetch, extract, scan, delete the workspace. A
   * fixture scan touches none of it.
   */
  /*
   * Chosen from a survey of public MCP servers (research/scan-public-mcp.ts), then re-measured
   * one by one through the exact path this seed uses — tarball, extract, `buildScanContext`,
   * `runScan` — so the counts below are what the deployment will actually store, not what a
   * `git clone` of the same repository happens to produce.
   *
   * The list this replaced was picked before that distinction was drawn and it showed. Four of
   * its seven repositories returned nothing, and of the twenty-three findings the other three
   * produced, sixteen sat in `examples/` and `tests/` — including all eleven of `vercel/ai`'s,
   * which is why "those are example servers" kept being the first thing anyone said about it.
   * Every finding below is in shipped code.
   *
   * Two selection rules did the work, in this order:
   *
   *   1. MCP-specific classes over general application security. `unauth-mcp-transport`,
   *      `missing-schema-validation` and `unbounded-tool-param` are about agentic
   *      infrastructure — a tool surface, a transport — and are the half of this product no
   *      conventional scanner models. A CORS header in an MCP server's HTTP layer is a web bug
   *      that happens to live in an MCP repository, and it is not why anyone would buy this.
   *   2. Production paths over test/example paths, which is rule 1's precondition: a finding in
   *      a fixture is not evidence about the shipped artefact, and being asked to explain that
   *      is how the last set lost the room.
   *
   * `spec-workflow-mcp` carries the single most valuable finding in the set. It is the only
   * repository here with a production `unauth-mcp-transport` — two of them, both critical, both
   * a dashboard bound to 0.0.0.0 with no credential-bearing control applied to the route — and
   * that class is the clearest answer this product has to "what does this find that Semgrep
   * does not".
   *
   * Order matters and this one is deliberate. The dashboard's overview and several of its pages
   * key off the most recent scan, and these are seeded sequentially, so whatever is LAST is what
   * an evaluator lands on first. `modelcontextprotocol/servers` holds that slot: the reference
   * implementation every MCP server is copied from, at a hundred-plus findings.
   *
   * The two zero-finding repositories are load-bearing, not filler. The corpus can only ever
   * demonstrate recall — it is built from planted vulnerabilities — so well-maintained
   * third-party code coming back empty is the only precision evidence here that nobody in this
   * repository controls. Removing them to raise the total would delete the argument.
   *
   * Counts are verified-tier at the SHA in brackets and will drift as these repositories change;
   * they are here to make a surprise legible ("this used to find fifty"), not as an assertion
   * about today. Re-derive with `pnpm research:scan-mcp`.
   */
  const DEFAULT_DEMO_REPOS = [
    // Clean, and deliberately so — both are well-regarded and neither yields a verified finding.
    "microsoft/playwright-mcp", // 0 verified, 0 research (55679f5)
    "GLips/Figma-Context-MCP", // 0 verified, 1 research (c083d65)
    // 11 missing-schema-validation: MCP handlers taking `args: any` with no runtime check.
    "Coding-Solo/godot-mcp", // 28 (1209744) — 17 unbounded-tool-param, 11 missing-schema-validation
    // The flagship: 2 critical unauth-mcp-transport in src/dashboard/, both binding 0.0.0.0.
    "Pimzino/spec-workflow-mcp", // 24 (d38e82e) — 19 unbounded-tool-param, 3 missing-schema-validation, 2 unauth-mcp-transport
    "wonderwhy-er/DesktopCommanderMCP", // 50 (1eccc8b) — 49 unbounded-tool-param, 1 unpinned-dependency
    "sooperset/mcp-atlassian", // 53 (31c1d77) — 48 unbounded-tool-param, 5 unpinned-dependency; also 77 research-tier
    "mongodb-js/mongodb-mcp-server", // 54 (39fcf3e) — 49 unbounded-tool-param, 5 unpinned-dependency
    "firecrawl/firecrawl-mcp-server", // 63 (41c2571) — 55 unbounded-tool-param, 6 missing-schema-validation, 2 unpinned-dependency
    "supabase-community/supabase-mcp", // 147 (5cda067) — 145 unbounded-tool-param (+2 unauth-mcp-transport, test paths)
    // Last on purpose: the overview keys off the newest scan, and this is the reference server set.
    "modelcontextprotocol/servers", // 104 (76d64c8) — 78 unbounded-tool-param, 24 unpinned-dependency, 2 cors-misconfig
  ];
  const demoReposRaw = process.env.GATEPASS_DEMO_REPOS?.trim();
  const demoRepos = isOff(demoReposRaw)
    ? []
    : (demoReposRaw ? demoReposRaw.split(",") : DEFAULT_DEMO_REPOS).map((r) => r.trim()).filter(Boolean);
  const fixture = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "corpus",
    "eval-repos",
    "vulnerable-nextjs-mcp",
  );
  const seedDemoScans = async () => {
    const h = makeHandlers(store, { repoFetcher });
    let scanned = 0;
    for (const repo of demoRepos) {
      try {
        // Sequential on purpose: five concurrent tarball downloads is the fastest way to spend
        // an anonymous rate-limit allowance, and nothing is waiting on this.
        const seed = await h.scanRemoteRepo("demo", repo);
        scanned++;
        console.log(
          `  ${repo}@${seed.sha?.slice(0, 7) ?? "HEAD"} — ${seed.verified} verified, ${seed.research} research`,
        );
      } catch (err) {
        // Offline, rate-limited, or a bad name: say which, and keep going. One unreachable repo
        // should not cost the deployment the other four.
        console.warn(`  ${repo} — skipped: ${(err as Error).message}`);
      }
    }
    if (scanned > 0) {
      console.log(`Seeded ${scanned} demo scan(s) of public repositories.`);
      return;
    }
    if (!existsSync(fixture)) return;
    try {
      const seed = await h.createScan("demo", fixture, "corpus/eval-repos/vulnerable-nextjs-mcp");
      console.log(
        `Seeded a demo scan of the bundled fixture (${seed.verified} verified, ${seed.research} research). ` +
          `This is Gatepass's own test repo, not third-party code — the dashboard says so.`,
      );
    } catch (err) {
      console.warn("demo scan seed failed:", (err as Error).message);
    }
  };

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`Gatepass API on :${port} (store: ${storeLabel})`);
    /*
     * Close the database on the way out.
     *
     * Not tidiness: an Atlas cluster counts open connections against a small free-tier cap, and
     * a development loop that restarts the API twenty times without closing exhausts it — which
     * presents as "the database is down" long after the process that held them is gone.
     */
    if (closeStore) {
      const shutdown = () => void closeStore!().finally(() => process.exit(0));
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }
    if (storeLabel === "memory") {
      console.warn(
        "  No datastore configured — every org, scan, finding and session lives in this process " +
          "and is lost on restart. Set MONGODB_URI (or DATABASE_URL) to persist.",
      );
    }
    /*
     * Seeded after the port is open, not before.
     *
     * The seed now makes a network round-trip, and blocking `listen` on it would mean a slow or
     * unreachable GitHub delays the API being ready — trading a working deployment for a
     * populated one. And only into an empty org: a persistent store already has this history,
     * so re-seeding every restart would silently accumulate duplicate scans of the same repo.
     */
    void (async () => {
      const existing = store.listScans ? await store.listScans("demo").catch(() => []) : [];
      if (existing.length === 0) await seedDemoScans();
    })();
  });
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) await startServer();
