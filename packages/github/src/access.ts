/**
 * Who may see which repositories, answered by GitHub rather than by Gatepass.
 *
 * The product model this implements: an organization installs the Gatepass App on their GitHub
 * org, and from then on the people who may use Gatepass for a repository are exactly the people
 * GitHub already says may work on that repository. Nobody is invited, provisioned, or given a
 * role by hand — there is no second list to keep in sync with GitHub, because a second list is
 * how someone keeps access after they have been removed from the org.
 *
 * That is a security property, not a convenience one, so the resolution is deliberately not
 * clever. Every question below is asked of GitHub with the *user's own* credentials wherever
 * GitHub will answer it that way, so the answer is scoped to them by GitHub's own permission
 * model and cannot be widened by a bug on our side.
 *
 * ## The two paths, and why there are two
 *
 * **GitHub App (`resolveViaInstallations`) — exact, and the one to deploy.** A GitHub App's
 * user-to-server token can call `GET /user/installations` ("which installations of this App can
 * this user reach") and `GET /user/installations/{id}/repositories` ("of the repositories this
 * installation covers, which may this user see"). The second endpoint *is* the intersection
 * this module exists to compute, computed by GitHub, including team grants, nested teams,
 * outside collaborators and repository-level overrides. We do not reimplement any of it.
 *
 * **OAuth App (`resolveViaCollaborators`) — the fallback.** A classic OAuth App has no
 * installations, so `GET /user/installations` is not available to it. There the org list comes
 * from the user's own memberships and the per-repository answer comes from
 * `GET /repos/{owner}/{repo}/collaborators/{login}/permission` asked with the *installation*
 * token. It is exact too, but it costs one request per repository and needs a GitHub App
 * installation token to ask with — so a deployment with neither ends up at
 * `granularity: "org-membership"`, which is honest but coarse.
 *
 * The distinction is surfaced on every grant (`OrgGrant.granularity`) rather than hidden,
 * because "this user sees every repo in the org" and "this user sees the four repos they
 * collaborate on" are very different claims and an operator must be able to tell which one
 * their deployment is actually making.
 *
 * ## Failure denies
 *
 * Every lookup here treats an error as "no access established", never as "no restriction". A
 * GitHub outage must cost people access they have; it must never hand anyone access they do
 * not. That is why the fetch helpers return undefined/[] on failure instead of throwing past
 * the caller, and why `resolveAccess` can legitimately return zero orgs.
 */

import { roleFromGitHubOrgRole, roleFromGitHubPermission, type Role } from "@gatepass/shared";
import type { GitHubUser } from "./oauth.js";

type FetchLike = typeof fetch;

const API_BASE = "https://api.github.com";

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

/** GitHub's repository permission vocabulary, finest-grained form (`role_name`). */
export type RepoPermission = "admin" | "maintain" | "write" | "triage" | "read";

const PERMISSION_RANK: Record<RepoPermission, number> = { read: 0, triage: 1, write: 2, maintain: 3, admin: 4 };

/** One repository the signed-in user may work on, and at what level. */
export interface RepoGrant {
  /** `owner/name`. */
  name: string;
  permission: RepoPermission;
}

/**
 * How a repository list was established. Carried on the grant so the answer can be read
 * honestly — see the module header.
 */
export type AccessGranularity = "installation" | "collaborator" | "org-membership";

/** One GitHub org (or user account) the signed-in user reaches Gatepass through. */
export interface OrgGrant {
  /** The GitHub org login the App is installed on. This is the Gatepass tenant id. */
  login: string;
  /** The App installation, when it was resolved through one. */
  installationId?: number;
  /** Whether the account the App is installed on is an organization or a personal account. */
  accountType: "Organization" | "User";
  /**
   * Org-wide role. Derived from *organization membership only*: an owner is `admin`, a member
   * is `member`.
   *
   * An outside collaborator is not a member of the org at all, so they land on `viewer` here
   * however much power they hold over an individual repository — a repository admin who is not
   * in the org must not be able to change the org's gate policy or export its evidence. What
   * they can do to the repositories they *do* hold is decided per repository, from `repos`
   * below, and is not capped by this value.
   */
  role: Role;
  /** True when GitHub reports an active organization membership (as opposed to a collaborator). */
  member: boolean;
  repos: RepoGrant[];
  granularity: AccessGranularity;
}

/** Everything Gatepass knows about one person's access, as of `resolvedAt`. */
export interface AccessGrant {
  githubUserId: number;
  login: string;
  orgs: OrgGrant[];
  /** ISO timestamp. Staleness is the caller's policy — see the API's access service. */
  resolvedAt: string;
}

/** A Gatepass App installation the signed-in user can reach. */
export interface UserInstallation {
  installationId: number;
  /** The org or user login the App is installed on. */
  account: string;
  accountType: "Organization" | "User";
}

/**
 * Highest permission GitHub reports for the authenticated user on a repository.
 *
 * Two payload shapes answer this question and they disagree about vocabulary. Repository
 * objects carry a `permissions` boolean map (`push`, not `write`); the collaborator-permission
 * endpoint carries a coarse `permission` string plus a finer `role_name`. `role_name` is
 * preferred where present because `permission` flattens `maintain` into `write` and `triage`
 * into `read`, and losing that distinction would silently demote maintainers.
 *
 * Returns undefined when GitHub reports no access — including the literal `"none"` that the
 * collaborator endpoint returns for a non-collaborator, which is an answer meaning "no", not a
 * permission level.
 */
function permissionOf(raw: {
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean };
  permission?: string;
  role_name?: string;
}): RepoPermission | undefined {
  const named = (raw.role_name ?? raw.permission ?? "").toLowerCase();
  if (named === "none") return undefined;
  if (named === "admin" || named === "maintain" || named === "triage" || named === "read") return named;
  if (named === "write" || named === "push") return "write";
  if (named === "pull") return "read";

  const p = raw.permissions;
  if (!p) return undefined;
  if (p.admin) return "admin";
  if (p.maintain) return "maintain";
  if (p.push) return "write";
  if (p.triage) return "triage";
  if (p.pull) return "read";
  return undefined;
}

/** Whichever of two permissions grants more. */
export function maxPermission(a: RepoPermission, b: RepoPermission): RepoPermission {
  return PERMISSION_RANK[a] >= PERMISSION_RANK[b] ? a : b;
}

/** `status: 0` is a network failure — no answer at all, as opposed to an answer of "no". */
async function get(url: string, token: string, fetchImpl: FetchLike): Promise<{ status: number; body?: unknown }> {
  try {
    const res = await fetchImpl(url, { headers: headers(token) });
    if (!res.ok) return { status: res.status };
    return { status: res.status, body: await res.json() };
  } catch {
    return { status: 0 };
  }
}

async function getJson(url: string, token: string, fetchImpl: FetchLike): Promise<unknown | undefined> {
  // Network failure is "we could not establish access", which is the same as no access.
  return (await get(url, token, fetchImpl)).body;
}

/**
 * What `GET /user/installations` told us, with "the endpoint answered" kept separate from
 * "the answer was none".
 *
 * That distinction is the single most load-bearing thing in this module. An empty list from a
 * GitHub App token means *this user reaches no installation*, which must deny. A 403 means
 * *this credential is not a GitHub App*, which must fall back to the coarser path. Collapsing
 * the two — as a bare `UserInstallation[]` return would — makes a user with no installations
 * fall through to org-membership access and receive every repository in every org they belong
 * to, which is the precise over-grant the installation path exists to prevent.
 */
export type InstallationsResult =
  | { available: true; installations: UserInstallation[] }
  | { available: false; reason: "not-a-github-app" | "unavailable" };

/**
 * Gatepass App installations the signed-in user can reach (`GET /user/installations`).
 *
 * This is the "which organizations that I am in have Gatepass" question, and GitHub answers it
 * directly — an org appears here only if the App is installed on it *and* this user can reach
 * that installation. We never enumerate orgs and ask whether each has Gatepass.
 */
export async function listUserInstallations(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
  { maxPages = 3 }: { maxPages?: number } = {},
): Promise<InstallationsResult> {
  const out: UserInstallation[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { status, body } = await get(
      `${API_BASE}/user/installations?per_page=100&page=${page}`,
      accessToken,
      fetchImpl,
    );
    if (status === 401 || status === 403 || status === 404) {
      // What a classic OAuth App token gets. A supported deployment, not an error.
      return { available: false, reason: "not-a-github-app" };
    }
    if (!body) {
      // A 5xx or a dead socket. We do not know what this user may reach, and guessing wide is
      // the one answer that is never safe.
      return { available: false, reason: "unavailable" };
    }
    const page1 = body as { installations?: { id?: number; account?: { login?: string; type?: string } }[] };
    const batch = Array.isArray(page1.installations) ? page1.installations : [];
    for (const raw of batch) {
      const login = raw.account?.login;
      if (typeof raw.id !== "number" || !login) continue;
      out.push({
        installationId: raw.id,
        account: login,
        accountType: raw.account?.type === "User" ? "User" : "Organization",
      });
    }
    if (batch.length < 100) break;
  }
  return { available: true, installations: out };
}

/**
 * The repositories one installation covers **that this user may also see**
 * (`GET /user/installations/{id}/repositories`).
 *
 * The whole per-repository access model rests on this one call, because the intersection is
 * GitHub's to compute and not ours. A user who is an outside collaborator on two repositories
 * of a fifty-repository installation gets two entries here; that they cannot see the other
 * forty-eight is not something Gatepass has to work out, enforce, or get right.
 */
export async function listUserInstallationRepos(
  accessToken: string,
  installationId: number,
  fetchImpl: FetchLike = fetch,
  { maxPages = 5 }: { maxPages?: number } = {},
): Promise<RepoGrant[]> {
  const out: RepoGrant[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = (await getJson(
      `${API_BASE}/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
      accessToken,
      fetchImpl,
    )) as { repositories?: { full_name?: string; permissions?: Record<string, boolean> }[] } | undefined;
    const batch = Array.isArray(body?.repositories) ? body.repositories : [];
    for (const raw of batch) {
      if (typeof raw.full_name !== "string") continue;
      // A repository listed with no permission block still reached the user through the
      // installation, so it is visible; `read` is the least it can be.
      out.push({ name: raw.full_name, permission: permissionOf(raw) ?? "read" });
    }
    if (batch.length < 100) break;
  }
  return out;
}

/** One entry from `GET /user/memberships/orgs`. */
export interface UserOrgMembership {
  login: string;
  /** `"active"`, or `"pending"` for an unaccepted invitation. */
  state: string;
  /** `"admin"` (owner) or `"member"`. */
  role: string;
}

/**
 * Every organization membership the signed-in user holds (`GET /user/memberships/orgs`, needs
 * `read:org`). One call for all orgs, rather than one per org.
 *
 * Pending invitations are returned as-is with `state: "pending"`; filtering them is the
 * caller's job, and every caller here filters them, because an invitation someone has not
 * accepted is not membership.
 */
export async function listUserOrgMemberships(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
  { maxPages = 3 }: { maxPages?: number } = {},
): Promise<UserOrgMembership[]> {
  const out: UserOrgMembership[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = (await getJson(
      `${API_BASE}/user/memberships/orgs?per_page=100&page=${page}`,
      accessToken,
      fetchImpl,
    )) as { state?: string; role?: string; organization?: { login?: string } }[] | undefined;
    const batch = Array.isArray(body) ? body : [];
    for (const raw of batch) {
      const login = raw.organization?.login;
      if (!login) continue;
      out.push({ login, state: raw.state ?? "active", role: raw.role ?? "member" });
    }
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * One user's permission on one repository, asked with an **installation** token
 * (`GET /repos/{owner}/{repo}/collaborators/{login}/permission`).
 *
 * The installation token is used rather than the user's own because this endpoint requires the
 * caller to have push access to the repository — a read-only collaborator asking about
 * themselves gets 403, which is indistinguishable from "no access at all" and would quietly
 * lock out exactly the people it is meant to describe.
 *
 * Undefined means no access established: a non-collaborator (`permission: "none"`), a repo the
 * installation cannot see, or a failed call.
 */
export async function collaboratorPermission(
  repo: string,
  login: string,
  installationToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<RepoPermission | undefined> {
  const body = (await getJson(
    `${API_BASE}/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`,
    installationToken,
    fetchImpl,
  )) as { permission?: string; role_name?: string } | undefined;
  if (!body) return undefined;
  return permissionOf(body);
}

/** Everything `resolveAccess` needs that is not on the user. */
export interface AccessResolverOptions {
  /**
   * Repositories Gatepass already tracks for an org, used only by the fallback paths — the
   * installation path learns the repository list from GitHub and never calls this.
   */
  knownRepos?: (orgLogin: string) => Promise<string[]>;
  /**
   * A GitHub App installation token, for the per-repository collaborator check. Absent ⇒ the
   * fallback cannot be repository-granular and says so (`granularity: "org-membership"`).
   */
  installationToken?: string;
  /**
   * Tenants this deployment serves, lower-cased org logins. When set, an org outside it is
   * dropped even if GitHub says the user can reach it — this is how a single-tenant deployment
   * stays single-tenant while still using GitHub as the source of truth for *who* is in it.
   */
  orgAllowList?: readonly string[];
  /**
   * Whether an org login is already a Gatepass tenant. Used only by the fallback path, and
   * load-bearing there.
   *
   * The installation path can tell which of a user's orgs have Gatepass, because GitHub says so.
   * The fallback cannot — all it sees is "this person is a member of these five GitHub orgs",
   * and *nothing in that answer distinguishes a customer from an unrelated org they happen to
   * belong to*. Without this check the first such org becomes their tenant: an empty one gets
   * provisioned in Gatepass's name, and they land in it instead of the org whose data they came
   * to look at.
   *
   * So on the fallback path, being a Gatepass tenant is something only Gatepass's own records
   * can establish. Absent ⇒ no org passes, which is the fail-closed direction.
   */
  knownOrg?: (orgLogin: string) => Promise<boolean>;
  /** Cap on per-repository collaborator checks, so a large org cannot hang a sign-in. */
  maxCollaboratorChecks?: number;
  fetchImpl?: FetchLike;
}

function allowed(login: string, allowList: readonly string[] | undefined): boolean {
  return !allowList || allowList.length === 0 || allowList.includes(login.toLowerCase());
}

/**
 * Org role from a membership list, for an account the App is installed on.
 *
 * A personal-account installation is the account owner's own: `octocat` installing Gatepass on
 * `octocat` is an admin of that tenant by construction, and there is no org membership to look
 * up because there is no org.
 */
function orgRoleFor(
  account: string,
  accountType: "Organization" | "User",
  user: GitHubUser,
  memberships: Map<string, UserOrgMembership>,
): { role: Role; member: boolean } {
  if (accountType === "User") {
    const own = account.toLowerCase() === user.login.toLowerCase();
    return { role: own ? "admin" : "viewer", member: own };
  }
  const m = memberships.get(account.toLowerCase());
  if (!m || m.state !== "active") return { role: "viewer", member: false };
  return { role: roleFromGitHubOrgRole(m.role, m.state), member: true };
}

/**
 * Lift an outside collaborator to `member` when they hold write on something.
 *
 * Somebody who is not in the org but has push access to a repository is a contributor to that
 * repository, and scanning it or disputing a finding on it is ordinary contributor work. They
 * stay short of `admin` no matter what they hold, because `admin` governs org-wide settings,
 * evidence export and gate policy — things that are not theirs to change.
 */
function effectiveOrgRole(base: { role: Role; member: boolean }, repos: RepoGrant[]): Role {
  if (base.member) return base.role;
  // Write on anything makes them a contributor to this tenant; the cap at `member` is the point.
  const contributes = repos.some((r) => roleFromGitHubPermission(r.permission) !== "viewer");
  return contributes ? "member" : "viewer";
}

/** The GitHub App path: exact, one call per installation. */
async function resolveViaInstallations(
  user: GitHubUser,
  installations: UserInstallation[],
  memberships: Map<string, UserOrgMembership>,
  opts: AccessResolverOptions,
): Promise<OrgGrant[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const out: OrgGrant[] = [];
  for (const inst of installations) {
    if (!allowed(inst.account, opts.orgAllowList)) continue;
    const repos = await listUserInstallationRepos(user.accessToken, inst.installationId, fetchImpl);
    /*
     * An installation the user can reach but which shares no repository with them is dropped.
     * Keeping it would put an org in their switcher whose every page is empty, and — worse —
     * would make them a tenant of an org they can see nothing in, which is a membership claim
     * we have no evidence for.
     */
    if (repos.length === 0) continue;
    const base = orgRoleFor(inst.account, inst.accountType, user, memberships);
    out.push({
      login: inst.account,
      installationId: inst.installationId,
      accountType: inst.accountType,
      role: effectiveOrgRole(base, repos),
      member: base.member,
      repos,
      granularity: "installation",
    });
  }
  return out;
}

/**
 * The OAuth App fallback: org membership for the tenant list, then a per-repository
 * collaborator check for each repository Gatepass already tracks in that org.
 *
 * Only repositories Gatepass knows about are checked. That is not a shortcut — a repository
 * nobody has connected has nothing to show, so establishing whether this user could see it
 * would be work done to populate an empty page.
 *
 * And only orgs Gatepass already knows are considered at all. GitHub's membership list cannot
 * tell a customer from an unrelated org somebody happens to belong to, so on this path that
 * question is one only our own tenant records can answer — see `knownOrg`.
 */
async function resolveViaCollaborators(
  user: GitHubUser,
  memberships: UserOrgMembership[],
  opts: AccessResolverOptions,
): Promise<OrgGrant[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const budget = opts.maxCollaboratorChecks ?? 200;
  let spent = 0;
  const out: OrgGrant[] = [];

  for (const m of memberships) {
    if (m.state !== "active") continue;
    if (!allowed(m.login, opts.orgAllowList)) continue;
    if (!(await opts.knownOrg?.(m.login))) continue;
    const known = (await opts.knownRepos?.(m.login)) ?? [];
    const base = { role: roleFromGitHubOrgRole(m.role, m.state), member: true };

    if (!opts.installationToken) {
      /*
       * No installation token, so there is no way to ask GitHub who collaborates on what. The
       * user is a member of the org, so they see the org's repositories — and the grant says
       * `org-membership` so that this coarser answer is legible rather than passing for the
       * repository-level one.
       */
      out.push({
        login: m.login,
        accountType: "Organization",
        role: base.role,
        member: true,
        repos: known.map((name) => ({ name, permission: "write" as RepoPermission })),
        granularity: "org-membership",
      });
      continue;
    }

    const repos: RepoGrant[] = [];
    for (const name of known) {
      if (spent >= budget) break;
      spent++;
      const permission = await collaboratorPermission(name, user.login, opts.installationToken, fetchImpl);
      if (permission) repos.push({ name, permission });
    }
    out.push({
      login: m.login,
      accountType: "Organization",
      role: base.role,
      member: true,
      repos,
      granularity: "collaborator",
    });
  }
  return out;
}

/**
 * Resolve everything Gatepass will let this person see, from GitHub.
 *
 * Which path runs is decided by what `GET /user/installations` *did*, not by what it returned:
 *
 *   - **It answered** ⇒ the installation path is authoritative and its answer stands, including
 *     when that answer is "no installations". A GitHub App deployment where this user reaches
 *     nothing means they see nothing; falling back there would quietly undo the precision the
 *     installation path exists for.
 *   - **It refused the credential** (`not-a-github-app`) ⇒ this is a classic OAuth App, a
 *     supported deployment, and the collaborator path takes over.
 *   - **It failed** (`unavailable`) ⇒ no access. We do not know what this user may reach and
 *     an outage must never be a way in.
 *
 * An empty `orgs` is a legitimate result, and the caller must treat it as "no access" — see
 * `admit` in the API handlers, which refuses the sign-in rather than opening an empty session.
 */
export async function resolveAccess(user: GitHubUser, opts: AccessResolverOptions = {}): Promise<AccessGrant> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const memberships = await listUserOrgMemberships(user.accessToken, fetchImpl);
  const byLogin = new Map(memberships.map((m) => [m.login.toLowerCase(), m]));

  const installations = await listUserInstallations(user.accessToken, fetchImpl);
  const orgs = installations.available
    ? await resolveViaInstallations(user, installations.installations, byLogin, opts)
    : installations.reason === "not-a-github-app"
      ? await resolveViaCollaborators(user, memberships, opts)
      : [];

  return {
    githubUserId: user.githubUserId,
    login: user.login,
    orgs,
    resolvedAt: new Date().toISOString(),
  };
}

/** The grant for one org, by login, case-insensitively. */
export function orgGrantOf(grant: AccessGrant | undefined, orgId: string): OrgGrant | undefined {
  return grant?.orgs.find((o) => o.login.toLowerCase() === orgId.toLowerCase());
}

/** The repository grant within an org, by `owner/name`, case-insensitively. */
export function repoGrantOf(org: OrgGrant | undefined, repo: string): RepoGrant | undefined {
  return org?.repos.find((r) => r.name.toLowerCase() === repo.toLowerCase());
}
