import type http from "node:http";
import { hasRole, parsePasswordHash, type Role, type Session } from "@gatepass/shared";
import { bearerToken } from "./tokens.js";

/**
 * Request authentication and authorization for the dashboard's session tokens.
 *
 * Two rules live here, and they are the whole of the change:
 *
 *  1. **A verified session outranks the `X-Org-Id` header.** That header used to decide both
 *     the rate-limit bucket and, by implication, which org a caller was talking about — so an
 *     anonymous caller could mint a fresh bucket per request just by varying it
 *     (`contracts/api.md`, "RBAC is still not enforced"). A signed session carries an org the
 *     caller cannot choose, so where one exists it wins outright and the header is ignored.
 *
 *  2. **Auth is required only where it has been configured.** A deployment with no
 *     `SESSION_SECRET` has no way to issue or check a session, and forcing one would break the
 *     CLI/curl workflows this API also serves. So: sessions configured ⇒ org-scoped writes
 *     require a valid session and a sufficient role; not configured ⇒ the routes behave as they
 *     did. Production sets the secret, which is the direction that has to fail closed.
 */

/**
 * Parse `GATEPASS_ALLOWED_LOGINS` — `"octocat,hubot:admin,dependabot:viewer"`.
 *
 * A bare login takes `GATEPASS_DEFAULT_ROLE`; `login:role` names one outright. This is how a
 * deployment with no GitHub organization to check membership against says who may sign in, and
 * without it (or `GATEPASS_GITHUB_ORG`) nobody is admitted at all — an OAuth app by itself
 * admits every GitHub account in existence, which for this product is not a default anyone
 * would choose on purpose.
 *
 * An entry naming a role that is not a real role is dropped rather than downgraded. A typo like
 * `octocat:admn` should stop that person signing in and be noticed, not silently hand them
 * read-only access and look like it worked.
 */
export function parseAllowedLogins(raw: string | undefined): { login: string; role?: Role }[] {
  if (!raw?.trim()) return [];
  const out: { login: string; role?: Role }[] = [];
  for (const entry of raw.split(",")) {
    const [rawLogin, rawRole] = entry.split(":");
    const login = rawLogin?.trim();
    if (!login) continue;
    const role = rawRole?.trim().toLowerCase();
    if (!role) {
      out.push({ login });
    } else if (role === "admin" || role === "member" || role === "viewer") {
      out.push({ login, role });
    }
  }
  return out;
}

/** One local account: a login, a stored scrypt hash, and the role it signs in at. */
export interface LocalUser {
  login: string;
  passwordHash: string;
  role: Role;
}

/**
 * Parse `GATEPASS_LOCAL_USERS` — `"admin:scrypt$32768$8$1$…$…:admin,reviewer:scrypt$…"`.
 *
 * Entries are `login:hash` or `login:hash:role`. The hash is validated here rather than at
 * sign-in, so a deployment with a mangled entry has *no such user* instead of a user who can
 * never authenticate but still exists to be probed — and the boot log can report how many
 * accounts are really configured rather than how many were written down.
 *
 * The role defaults to `viewer`, which is the odd choice worth stating: the obvious use for
 * this door is handing somebody a look at a live deployment, and read-only is what that
 * actually needs. A deployment that wants more says `:admin` and means it.
 */
export function parseLocalUsers(raw: string | undefined): LocalUser[] {
  if (!raw?.trim()) return [];
  const out: LocalUser[] = [];
  for (const entry of raw.split(",")) {
    // Split from the left on the FIRST colon only for the login; the hash itself contains `$`
    // but never `:`, and a trailing `:role` is optional — so at most three fields.
    const parts = entry.trim().split(":");
    const login = parts[0]?.trim();
    const passwordHash = parts[1]?.trim();
    if (!login || !passwordHash) continue;
    if (!parsePasswordHash(passwordHash)) continue;
    const rawRole = parts[2]?.trim().toLowerCase();
    const role: Role = rawRole === "admin" || rawRole === "member" || rawRole === "viewer" ? rawRole : "viewer";
    out.push({ login, passwordHash, role });
  }
  return out;
}

/**
 * Failed-attempt accounting for the password door.
 *
 * The general rate limiter buckets by org, and an unauthenticated sign-in attempt has no org —
 * so every anonymous request in the deployment shares one bucket, which means an attacker
 * guessing passwords also exhausts the quota for everybody else, and the limit that stops them
 * is the same limit that breaks the product. This is separate for that reason, and counts
 * *failures* rather than requests: somebody signing in successfully all day is not an attack.
 *
 * Keyed by login and by source address independently. Login alone lets one host spray many
 * logins; address alone lets a botnet grind one login. Both must be under the limit.
 */
export class PasswordAttemptLimiter {
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  private key(scope: string, value: string): string {
    return `${scope}:${value.toLowerCase()}`;
  }

  /** Whether this attempt may proceed, and how long until it may if not. */
  check(login: string, address: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    let worst = 0;
    for (const k of [this.key("login", login), this.key("addr", address)]) {
      const entry = this.failures.get(k);
      if (!entry) continue;
      if (entry.until <= now) {
        this.failures.delete(k);
        continue;
      }
      if (entry.count >= this.maxFailures) worst = Math.max(worst, entry.until - now);
    }
    return worst > 0 ? { allowed: false, retryAfterMs: worst } : { allowed: true, retryAfterMs: 0 };
  }

  /** Record a failure against both keys, extending the window from the most recent attempt. */
  fail(login: string, address: string, now = Date.now()): void {
    for (const k of [this.key("login", login), this.key("addr", address)]) {
      const entry = this.failures.get(k);
      const count = entry && entry.until > now ? entry.count + 1 : 1;
      this.failures.set(k, { count, until: now + this.windowMs });
    }
  }

  /**
   * Clear the counters for a successful sign-in.
   *
   * Only the login's own counter and the address it came from — a correct password proves the
   * attempts against *this* login were not an attack, and leaving the count would lock a user
   * out for the rest of the window after five typos followed by getting it right.
   */
  succeed(login: string, address: string): void {
    this.failures.delete(this.key("login", login));
    this.failures.delete(this.key("addr", address));
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface RequestAuth {
  /** The verified session, when the request carried one. */
  session: Session | null;
  /** Whether this deployment can issue and check sessions at all. */
  enabled: boolean;
}

/** Read and verify the `Authorization: Bearer <session>` header. */
export async function readAuth(
  headers: http.IncomingHttpHeaders,
  // Async because verification now includes a revocation lookup, which is I/O.
  verify: (token: string | undefined) => Promise<Session | null>,
  enabled: boolean,
): Promise<RequestAuth> {
  return { session: await verify(bearerToken(headers["authorization"])), enabled };
}

/**
 * The org this request is about. A session's org is authoritative; otherwise fall back to the
 * path segment, then the caller-supplied header, then the runner query param.
 *
 * The header is last on purpose. It is the only one of the four an unauthenticated caller can
 * set freely, so it must never be able to displace a value the server already knows.
 */
export function resolveOrgId(
  auth: RequestAuth,
  headers: http.IncomingHttpHeaders,
  p: string[],
  /**
   * The org the runner's bearer token maps to, resolved by the caller (which owns the token
   * registry). Undefined when the token is absent or unrecognised.
   */
  runnerOrgId?: string,
): string {
  if (auth.session) return auth.session.orgId;
  if (p[1] === "orgs" && p[2]) return p[2];
  /*
   * The runner's bucket comes from its token, never from `?orgId=`.
   *
   * The rate limiter runs before the route validates that token, so the query string was
   * reaching the limiter unauthenticated — and a caller who varies a value they control gets a
   * fresh bucket per request, which is the whole point of a rate limit gone. It is the same
   * hole that was closed for `X-Org-Id`, one layer down. Unauthenticated runner traffic now
   * shares a single bucket, so flooding the route costs the flooder their own quota.
   */
  if (p[1] === "runner") return runnerOrgId ?? "unauthenticated-runner";
  const fromHeader = headers["x-org-id"];
  if (typeof fromHeader === "string" && fromHeader) return fromHeader;
  return "unknown";
}

/**
 * Gate an org-scoped route.
 *
 * `minimum` is the role a *write* needs; reads pass `undefined` and require no particular role,
 * but on a deployment that has sessions they still require *a* session — see `authorizeAction`.
 *
 * A session for org A asking about org B is 403, not a silent redirect to A: a dashboard that
 * quietly answered about a different tenant than the URL named would be worse than an error.
 */
export function authorizeOrg(auth: RequestAuth, orgIdInPath: string, minimum?: Role): void {
  if (auth.session && auth.session.orgId !== orgIdInPath) {
    throw new AuthError(`this session is not a member of org "${orgIdInPath}"`, 403);
  }
  authorizeAction(auth, minimum);
}

/**
 * Gate an action whose org is not in the path — `POST /v1/findings/:fp/dispute`,
 * `POST /v1/fleet/servers/:id/rescan` and `POST /v1/scans/:id/gate` name a record, not a
 * tenant. The role still has to hold; the tenant is checked separately against the record
 * (see the `p[1] === "scans"` block in server.ts).
 */
export function authorizeAction(auth: RequestAuth, minimum?: Role): void {
  if (auth.session) {
    if (minimum && !hasRole(auth.session.role, minimum)) {
      throw new AuthError(`role "${auth.session.role}" is insufficient; "${minimum}" required`, 403);
    }
    return;
  }
  /*
   * No session.
   *
   * Where sessions exist, reads are refused too — not just writes. Gating `/dashboard` in the
   * web middleware while this API answered `GET /v1/orgs/demo/scans` to anyone would not be
   * access control: findings describe exploitable vulnerabilities in customer code and carry
   * reproductions, org ids are short and guessable, and that scan list hands out the scan ids
   * that then unlock findings and SARIF. The dashboard's front door is only a door if the API
   * behind it has one.
   *
   * A deployment with no session secret is unchanged: it cannot check a session, so demanding
   * one would lock out the CLI and curl workflows this API also serves with no way back in.
   * That is a deliberate posture for a single-tenant local API, and production sets the secret,
   * which is the direction that has to fail closed.
   */
  if (auth.enabled) {
    throw new AuthError(minimum ? "sign in to perform this action" : "sign in to view this", 401);
  }
}

/**
 * The minimum role a request to an org-scoped route needs.
 *
 * Reads need none. Beyond that the split is between *what Gatepass looks at* and *what
 * Gatepass does about it*: adding something to scan is ordinary work (`member`), while
 * changing gate policy, removing inventory, exporting evidence to a compliance platform, or
 * opening a pull request against customer code are all `admin`.
 *
 * Kept as one table rather than a check per route so a route added later cannot quietly ship
 * ungated — the default for an unrecognised write is `member`, not "open".
 */
export function requiredRole(method: string | undefined, p: string[]): Role | undefined {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return undefined;
  const segment = p[3];
  if (segment === "settings") return "admin";
  if (segment === "evidence") return "admin";
  // Connecting is `member` because scanning a repo already connects it — an inventory a
  // member can add to by one route and not the other would just be confusing. Changing gate
  // policy (PATCH) or removing the record (DELETE) is admin.
  if (segment === "repos") return method === "POST" ? "member" : "admin";
  // Suggested-fix pull requests write to a customer repository. Nothing below admin.
  if (p[5] === "fix-pr") return "admin";
  return "member";
}

/**
 * Whether the local development sign-in may be offered.
 *
 * Fail-closed by construction: it takes an explicit opt-in AND a non-production `NODE_ENV`.
 * Neither alone is enough, so the default in every environment is off, and setting the flag on
 * a production deployment does nothing. It is checked at request time rather than cached so a
 * test can exercise both answers without reloading the module.
 */
export function devAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.NODE_ENV ?? "").trim().toLowerCase() === "production") return false;
  const flag = (env.GATEPASS_DEV_AUTH ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}
