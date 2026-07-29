import { describe, it, expect } from "vitest";
import {
  hasRole,
  requireRole,
  RoleError,
  roleFromGitHubOrgRole,
  roleFromGitHubPermission,
  type Role,
} from "../src/index.js";

describe("role hierarchy", () => {
  const ROLES: Role[] = ["viewer", "member", "admin"];

  it("satisfies a requirement with that role or any higher one", () => {
    for (const [i, have] of ROLES.entries()) {
      for (const [j, need] of ROLES.entries()) {
        expect(hasRole(have, need)).toBe(i >= j);
      }
    }
  });

  it("requireRole names both the role held and the role needed", () => {
    expect(() => requireRole("admin", "admin")).not.toThrow();
    try {
      requireRole("viewer", "admin");
      expect.unreachable("requireRole should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RoleError);
      expect((err as RoleError).have).toBe("viewer");
      expect((err as RoleError).need).toBe("admin");
    }
  });
});

describe("roleFromGitHubOrgRole", () => {
  it("maps an organization owner to admin", () => {
    expect(roleFromGitHubOrgRole("admin")).toBe("admin");
  });

  it("maps an ordinary organization member to member", () => {
    expect(roleFromGitHubOrgRole("member")).toBe("member");
  });

  it("treats an unaccepted invitation as viewer regardless of the role it offers", () => {
    expect(roleFromGitHubOrgRole("member", "pending")).toBe("viewer");
    expect(roleFromGitHubOrgRole("admin", "pending")).toBe("viewer");
  });

  it("treats an unresolved membership as viewer", () => {
    expect(roleFromGitHubOrgRole(undefined)).toBe("viewer");
  });

  it("treats a role it does not recognise as viewer, losing privileges rather than gaining them", () => {
    expect(roleFromGitHubOrgRole("billing_manager")).toBe("viewer");
    expect(roleFromGitHubOrgRole("")).toBe("viewer");
    expect(roleFromGitHubOrgRole("ADMIN")).toBe("viewer");
  });

  it("defaults an unstated state to active", () => {
    expect(roleFromGitHubOrgRole("admin")).toBe("admin");
    expect(roleFromGitHubOrgRole("admin", "active")).toBe("admin");
  });
});

describe("roleFromGitHubPermission", () => {
  it("maps repository permissions to org roles", () => {
    expect(roleFromGitHubPermission("admin")).toBe("admin");
    expect(roleFromGitHubPermission("maintain")).toBe("admin");
    expect(roleFromGitHubPermission("write")).toBe("member");
    expect(roleFromGitHubPermission("push")).toBe("member");
    expect(roleFromGitHubPermission("read")).toBe("viewer");
    expect(roleFromGitHubPermission("triage")).toBe("viewer");
  });
});

describe('the two GitHub role vocabularies collide on "member"', () => {
  /*
   * GitHub uses "member" for an ordinary *organization* member — a full contributor — while a
   * *repository* permission is never "member", so the repository mapping falls that word
   * through to `viewer`. Running org roles through `roleFromGitHubPermission` would therefore
   * silently demote every contributor in the organization to read-only, and the failure would
   * look like a permissions bug rather than a mapping bug. The two functions must stay distinct.
   */
  it("disagrees about it, which is why there are two functions", () => {
    expect(roleFromGitHubOrgRole("member")).toBe("member");
    expect(roleFromGitHubPermission("member")).toBe("viewer");
    expect(roleFromGitHubOrgRole("member")).not.toBe(roleFromGitHubPermission("member"));
  });

  it("agrees about admin, which is the word that means the same thing in both", () => {
    expect(roleFromGitHubOrgRole("admin")).toBe(roleFromGitHubPermission("admin"));
  });
});
