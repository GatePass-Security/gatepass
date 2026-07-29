import {
  orgGrantOf,
  repoGrantOf,
  resolveAccess,
  type AccessGrant,
  type GitHubUser,
  type OrgGrant,
} from "@gatepass/github";
import { roleFromGitHubPermission, type Role } from "@gatepass/shared";
import type { Store, UserAccessRecord } from "./store.js";

/**
 * The API's view of who may see what — a cache in front of `resolveAccess`, plus the one
 * question the rest of the API actually asks: *may this session see this repository?*
 *
 * ## Why a cache exists at all
 *
 * Resolving access is several GitHub calls. Doing it on every request would put a GitHub
 * round-trip in front of every page load, and GitHub's rate limits would make the dashboard
 * unusable for a large org. So a grant is resolved at sign-in and kept.
 *
 * ## Why the cache expires quickly
 *
 * Because a cached grant is, precisely, access that GitHub may have already taken away.
 * Somebody removed from a repository at 10:00 keeps whatever Gatepass cached until it goes
 * stale, and for a product whose content is a list of exploitable vulnerabilities, "until they
 * next sign in" (up to a week) is not an acceptable answer. The TTL is therefore minutes, not
 * days, and refreshing is a background-ish cost paid by one request in a few hundred.
 *
 * ## Why the user's GitHub token is stored
 *
 * Refreshing needs the user's own token — that is the whole point, since asking GitHub *as the
 * user* is what makes the answer trustworthy. So the token is persisted next to the grant and
 * deleted on sign-out.
 *
 * That is a real secret at rest and worth being plain about: it is a `read:user read:org` token
 * with no `repo` scope, so it cannot read code, and it is strictly less powerful than the App
 * installation token this deployment already holds. The alternative — not storing it — means
 * either re-running OAuth on every page or letting revoked access persist for days, and both
 * are worse. Encrypt the column at the database layer if your threat model needs it.
 */

/** Seconds a cached grant is treated as current before GitHub is asked again. */
export const DEFAULT_ACCESS_TTL_SEC = 600;

export interface AccessDirectoryOptions {
  /** Injectable so tests do not reach GitHub. Defaults to the real resolver. */
  resolve?: typeof resolveAccess;
  /** Installation token for the collaborator fallback (see packages/github/src/access.ts). */
  installationToken?: string;
  /** Restrict tenants to these org logins — a single-tenant deployment stays single-tenant. */
  orgAllowList?: readonly string[];
  ttlSec?: number;
  fetchImpl?: typeof fetch;
}

/**
 * What a request may see, distilled to the two things every guard needs.
 *
 * `repos: null` means **no repository restriction** — not "no repositories". It is the answer
 * for a deployment that does not derive access from GitHub at all (no sessions, an explicit
 * allow-list, the local development sign-in), where there is no grant to narrow by and the
 * pre-existing posture is org-wide access. Every guard below is written so that this reads as
 * "unchanged behaviour" rather than as an accidental hole.
 */
export interface ViewerScope {
  orgId: string;
  role: Role;
  repos: Set<string> | null;
  /** Present only when a GitHub grant produced this scope; describes how exact it is. */
  granularity?: OrgGrant["granularity"];
}

/** Lower-case `owner/name`, the one form repository names are compared in. */
export function repoKey(name: string): string {
  return name.toLowerCase();
}

export class AccessDirectory {
  private readonly ttlSec: number;

  constructor(
    private readonly store: Store,
    private readonly opts: AccessDirectoryOptions = {},
  ) {
    this.ttlSec = opts.ttlSec ?? DEFAULT_ACCESS_TTL_SEC;
  }

  /** Whether this deployment derives access from GitHub at all. */
  get enabled(): boolean {
    return Boolean(this.store.putUserAccess && this.store.getUserAccess);
  }

  private async knownRepos(orgLogin: string): Promise<string[]> {
    if (!this.store.getRepos) return [];
    return (await this.store.getRepos(orgLogin)).map((r) => r.name);
  }

  /**
   * Whether an org login is already a Gatepass tenant.
   *
   * A record with a `githubOrgLogin` was provisioned from an installation; a record whose id
   * simply *is* the login covers a tenant an operator created by hand. Either is evidence that
   * this org is a customer, which is the question the fallback path cannot ask GitHub.
   */
  private async knownOrg(orgLogin: string): Promise<boolean> {
    if (await this.store.getOrg(orgLogin)) return true;
    const matches = await this.store.listOrgsByGithubLogin?.([orgLogin.toLowerCase()]);
    return Boolean(matches && matches.length > 0);
  }

  private resolverOptions() {
    return {
      knownRepos: (org: string) => this.knownRepos(org),
      knownOrg: (org: string) => this.knownOrg(org),
      ...(this.opts.installationToken ? { installationToken: this.opts.installationToken } : {}),
      ...(this.opts.orgAllowList?.length ? { orgAllowList: this.opts.orgAllowList } : {}),
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
    };
  }

  /**
   * Resolve this user's access from GitHub and record it. Called at sign-in, where the token
   * is in hand and the answer must be current rather than cached.
   *
   * `asAccountId` files the grant under an account id that is not the GitHub user's — used when
   * somebody signed in another way (a local password account) and is *linking* GitHub to the
   * identity they already have. Without it, linking would file the grant under the GitHub user
   * id, `scopeFor` would look it up under the session's id, find nothing, and the link would
   * appear to succeed while changing nothing at all.
   */
  async record(user: GitHubUser, asAccountId?: string): Promise<AccessGrant> {
    const resolve = this.opts.resolve ?? resolveAccess;
    const grant = await resolve(user, this.resolverOptions());
    await this.store.putUserAccess?.({
      githubUserId: asAccountId ?? String(user.githubUserId),
      login: user.login,
      accessToken: user.accessToken,
      grant,
      refreshedAt: new Date().toISOString(),
    });
    return grant;
  }

  /**
   * The current grant for a signed-in user, re-resolved from GitHub when the cached one has
   * aged past the TTL.
   *
   * A refresh that fails leaves the cached grant in place rather than dropping the user to no
   * access. That is a deliberate choice in the *opposite* direction from everywhere else in
   * this file, and the reason is that the two failures are not symmetric: refusing to widen on
   * a failed lookup protects the data, while refusing to *keep* an already-established grant on
   * a failed lookup just signs everybody out during a GitHub incident. The grant is still
   * bounded — it expires with the session — so the exposure is minutes of staleness, not an
   * open door.
   */
  async forUser(githubUserId: string): Promise<AccessGrant | undefined> {
    const record = await this.store.getUserAccess?.(githubUserId);
    const cached = asGrant(record?.grant);
    if (!record || !cached) return undefined;
    const ageSec = (Date.now() - Date.parse(record.refreshedAt)) / 1000;
    if (!(ageSec > this.ttlSec) || !record.accessToken) return cached;

    const resolve = this.opts.resolve ?? resolveAccess;
    const user: GitHubUser = {
      githubUserId: Number(record.githubUserId),
      login: record.login,
      accessToken: record.accessToken,
    };
    try {
      const grant = await resolve(user, this.resolverOptions());
      await this.store.putUserAccess?.({ ...record, grant, refreshedAt: new Date().toISOString() });
      return grant;
    } catch {
      return cached;
    }
  }

  /** Forget a user's grant and, importantly, their stored GitHub token. Called on sign-out. */
  async forget(githubUserId: string): Promise<void> {
    await this.store.deleteUserAccess?.(githubUserId);
  }

  /**
   * The scope for one session, or undefined when this deployment has no grant for that user —
   * an allow-list sign-in, a development session, or a store with no access tables. The caller
   * decides what "no grant" means; it is never treated as "no access" here, because that would
   * break every deployment that does not use GitHub-derived access.
   */
  async scopeFor(session: { userId: string; orgId: string; role: Role }): Promise<ViewerScope | undefined> {
    const grant = await this.forUser(session.userId);
    const org = orgGrantOf(grant, session.orgId);
    if (!org) return undefined;
    return {
      orgId: session.orgId,
      // The stored session's role and the live grant can disagree — someone demoted from owner
      // to member since sign-in. The live grant wins, and the lower of the two is taken, so a
      // demotion takes effect at the next refresh rather than at the next sign-in.
      role: lowerOf(session.role, org.role),
      repos: new Set(org.repos.map((r) => repoKey(r.name))),
      granularity: org.granularity,
    };
  }

  /** Every org a user may reach, for the dashboard's org switcher and `/v1/auth/me`. */
  async orgsFor(githubUserId: string): Promise<OrgGrant[]> {
    return (await this.forUser(githubUserId))?.orgs ?? [];
  }

  /**
   * The role this user holds **on one repository**, which can exceed their org role: an outside
   * collaborator is `viewer` org-wide but may be an admin of the repository they collaborate
   * on, and refusing them a rescan of their own repository would be wrong.
   */
  async repoRole(githubUserId: string, orgId: string, repo: string): Promise<Role | undefined> {
    const org = orgGrantOf(await this.forUser(githubUserId), orgId);
    const grant = repoGrantOf(org, repo);
    return grant ? roleFromGitHubPermission(grant.permission) : undefined;
  }
}

/**
 * A stored JSON blob, if it is actually a grant.
 *
 * Postgres cannot type its own `jsonb`, so this is where "a row exists" becomes "a grant
 * exists". A row that is malformed — truncated, hand-edited, written by an older shape —
 * resolves to *no* grant rather than to an empty one or a partly-read one, which means the
 * caller denies. A cache that cannot be read must never read as permission.
 */
function asGrant(raw: unknown): AccessGrant | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as Partial<AccessGrant>;
  if (typeof g.login !== "string" || !Array.isArray(g.orgs)) return undefined;
  if (!g.orgs.every((o) => o && typeof o.login === "string" && Array.isArray(o.repos))) return undefined;
  return g as AccessGrant;
}

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };
function lowerOf(a: Role, b: Role): Role {
  return RANK[a] <= RANK[b] ? a : b;
}

/** Whether `scope` permits seeing `repo`. A null repo set permits everything (see ViewerScope). */
export function scopeAllows(scope: ViewerScope | undefined, repo: string | undefined): boolean {
  if (!scope || scope.repos === null) return true;
  /*
   * A record with no repository is refused under a repository-scoped view.
   *
   * These are the local-path scans — a directory on the API host, connected by running a scan
   * against it rather than through GitHub. GitHub has no opinion about who may see them, so
   * there is no grant that could cover one, and showing it to a user whose access is defined
   * entirely by repository grants would be showing them the one thing their grants do not
   * mention. They remain visible to deployments that are not GitHub-scoped, which is where
   * they are actually used.
   */
  if (!repo) return false;
  return scope.repos.has(repoKey(repo));
}

export type { UserAccessRecord };
