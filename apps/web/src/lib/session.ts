import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ApiClient from "./api-client";
import { API_BASE } from "./constants";
import { SESSION_COOKIE, STALE_SESSION_PATH, safeNextPath, type SessionClaims } from "./session-cookie";
import type { SessionInfo } from "./types";

/**
 * Server-side session access.
 *
 * The `next/headers` import is what keeps this module honest: Next refuses to compile a Client
 * Component that pulls it in, so an accidental import from the browser side is a build error
 * rather than a token quietly reaching the bundle. The whole point of keeping the session out
 * of the browser is undone by one careless import, so the guard has to be structural.
 */

/**
 * The API could not be asked whether this session is valid.
 *
 * Distinct from "the session is invalid" on purpose, and the distinction is the whole reason
 * this class exists: one means sign in again, the other means try again shortly, and treating
 * the second as the first hands people a sign-out every time the API hiccups.
 */
export class SessionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionUnavailableError";
  }
}

/** The raw session token from the cookie, for code that needs to forward it to the API. */
export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/**
 * The verified session, or null.
 *
 * This asks the API (`GET /v1/auth/me`), which is the only process holding the signing key.
 * Nothing in the web app can verify an HMAC the API issued, so nothing in the web app
 * pretends to: a cookie is a claim until the API agrees with it.
 */
export async function getSession(): Promise<SessionInfo | null> {
  const token = await sessionToken();
  if (!token) return null;
  return new ApiClient(API_BASE, token).session(token);
}

/**
 * The verified session, or a redirect to sign-in carrying where the user was going.
 *
 * Called from `(app)/layout.tsx`, so it runs once for every route in the product rather than
 * being something each page has to remember. The middleware has already turned away requests
 * with no cookie at all; this is the check that a *present* cookie is real.
 *
 * It redirects via `STALE_SESSION_PATH` rather than straight to `/login`, because a cookie that
 * fails *here* is still a cookie the middleware will accept — it only reads the claims — and
 * sending the user to `/login` while they still hold it means the middleware reads it there and
 * sends them back. That is an unbounded `/dashboard` → `/login` → `/dashboard` loop, and no
 * amount of care at either end escapes it while the dead cookie survives every hop.
 *
 * Nothing in a Server Component can clear it: `redirect()` cannot carry a `Set-Cookie`. So the
 * refusal goes through a Route Handler that can, and the request that lands on `/login` is a
 * genuinely signed-out one.
 */
export async function requireSession(nextPath?: string): Promise<SessionInfo> {
  let session: SessionInfo | null;
  try {
    session = await getSession();
  } catch (err) {
    /*
     * We could not ask, which is not the same as being told no — and the difference decides
     * whether the user keeps their session.
     *
     * Redirecting on "the API did not answer" would clear a cookie that is probably fine, so a
     * thirty-second outage would sign out everybody who loaded a page during it. Worse, it
     * cannot even redirect safely: the cookie is still there, the middleware still accepts it,
     * and `/login` would bounce straight back — the same loop `STALE_SESSION_PATH` exists to
     * break, re-entered through the one door that has no dead cookie to throw away.
     *
     * So this does not redirect at all. It surfaces the failure to the layout, which renders it
     * as a page, and the session survives the outage that caused it.
     */
    throw new SessionUnavailableError((err as Error)?.message ?? "the Gatepass API did not respond");
  }
  if (!session) {
    const next = safeNextPath(nextPath);
    redirect(`${STALE_SESSION_PATH}?next=${encodeURIComponent(next)}`);
  }
  return session;
}

/** An API client bound to this request's session, for Server Components. */
export async function serverApi(): Promise<ApiClient> {
  return new ApiClient(API_BASE, await sessionToken());
}

export type { SessionClaims };
