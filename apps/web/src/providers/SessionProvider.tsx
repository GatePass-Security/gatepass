"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { OrgMembershipSummary, Role } from "@/lib/types";

/**
 * The signed-in identity, handed down from the server.
 *
 * This replaces `ORG_ID`, the literal `"demo"` that thirteen files imported from
 * `lib/constants.ts` and compiled into the client bundle. The org now arrives from a session
 * the API verified, so the dashboard addresses the tenant the signed-in user actually belongs
 * to — and a half-migration, where some pages read the session and others still read `"demo"`,
 * would be worse than neither, so nothing imports that constant any more.
 *
 * The **session token is not here**. Only the claims are: id, login, org, role. The token
 * itself never leaves the server (`lib/session-cookie.ts` explains why), so there is nothing
 * in this context worth stealing and nothing a component could accidentally send somewhere.
 */

export interface SessionUser {
  userId: string;
  login: string;
  orgId: string;
  role: Role;
  /**
   * Every organization this GitHub account can reach, for the org switcher.
   *
   * Resolved by the API from GitHub at request time, so it reflects an org somebody joined this
   * morning without a fresh sign-in — and stops listing one they were removed from. Empty on a
   * deployment that does not derive access from GitHub, and the switcher renders nothing there
   * rather than offering a choice of one.
   */
  orgs?: OrgMembershipSummary[];
  /** True when this session came from the local development sign-in, not from GitHub. */
  development: boolean;
  /**
   * True when this session came from a local password account.
   *
   * Distinct from `development`: a local account is a legitimate way to be signed in on a
   * production deployment, and the only thing it lacks is a GitHub identity. The interface uses
   * this to offer connecting one, rather than to warn about the session.
   */
  local?: boolean;
}

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({ session, children }: { session: SessionUser; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/**
 * The signed-in user. Throws rather than returning null: every consumer lives under
 * `(app)/layout.tsx`, which cannot render without a verified session, so a missing provider is
 * a wiring bug and should say so instead of quietly degrading to a page with no org.
 */
export function useSession(): SessionUser {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession() outside SessionProvider — is this component under (app)/layout.tsx?");
  return session;
}

/** The org id for API calls — the single most common reason to reach for the session. */
export function useOrgId(): string {
  return useSession().orgId;
}

/** Whether the signed-in user holds at least `minimum`. Mirrors `hasRole` in @gatepass/shared. */
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };
export function useHasRole(minimum: Role): boolean {
  return RANK[useSession().role] >= RANK[minimum];
}
