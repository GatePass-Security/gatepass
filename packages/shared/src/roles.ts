/**
 * Role-based access control (FR-027, T076). Org roles form a strict hierarchy; a required
 * capability is satisfied by that role or any higher one. A user's role mirrors their GitHub
 * repository permission (admin > write > read → admin > member > viewer).
 */

export type Role = "admin" | "member" | "viewer";

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };

export function hasRole(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

export class RoleError extends Error {
  constructor(
    public readonly have: Role,
    public readonly need: Role,
  ) {
    super(`role "${have}" is insufficient; "${need}" required`);
    this.name = "RoleError";
  }
}

export function requireRole(role: Role, minimum: Role): void {
  if (!hasRole(role, minimum)) throw new RoleError(role, minimum);
}

/** Map a GitHub repository permission to a Gatepass org role. */
export function roleFromGitHubPermission(perm: string): Role {
  if (perm === "admin" || perm === "maintain") return "admin";
  if (perm === "write" || perm === "push") return "member";
  return "viewer";
}

/**
 * Map a GitHub **organization membership** role to a Gatepass org role.
 *
 * Distinct from `roleFromGitHubPermission` because the two vocabularies collide on one word
 * and disagree about it: a repository permission of `"member"` is not a thing, while an
 * *organization* role of `"member"` is the ordinary contributor — which is Gatepass's
 * `member`, not `viewer`. Running org roles through the repository mapping would silently
 * demote every contributor in the org to read-only.
 *
 * Anything that is not an active admin or member — an outside collaborator, a pending
 * invitation, a caller we could not resolve — lands on `viewer`, so an unrecognised answer
 * loses privileges rather than gaining them.
 */
export function roleFromGitHubOrgRole(orgRole: string | undefined, state = "active"): Role {
  if (state !== "active") return "viewer";
  if (orgRole === "admin") return "admin";
  if (orgRole === "member") return "member";
  return "viewer";
}
