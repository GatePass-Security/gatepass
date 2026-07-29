import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import ApiClient from "@/lib/api-client";
import { ApiError } from "@/lib/types";
import { API_BASE } from "@/lib/constants";
import {
  LINK_STATE_PREFIX,
  LOGIN_PATH,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  cookieOptions,
  safeNextPath,
} from "@/lib/session-cookie";

/**
 * GitHub's redirect back after authorization.
 *
 * Verifies `state` against the cookie set in `../start`, exchanges the code for a session
 * token through the API, and stores that token as an `httpOnly` cookie on this origin.
 *
 * Every failure below lands on the login page with a reason rather than a stack trace, and
 * every one of them clears the state cookie — a one-shot value that survived a failed attempt
 * would be available for a second, and replay is the thing `state` exists to prevent.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time compare of two same-purpose strings; length mismatch short-circuits safely. */
function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function backToLogin(req: NextRequest, error: string, next = "/dashboard"): NextResponse {
  const url = new URL(LOGIN_PATH, req.nextUrl.origin);
  url.searchParams.set("error", error);
  if (next !== "/dashboard") url.searchParams.set("next", next);
  const res = NextResponse.redirect(url);
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}

/**
 * Attach the authorized GitHub account to the session this browser already holds.
 *
 * The session token is **not** replaced. Somebody who signed in with a local account stays
 * signed in as that account; what changes is that Gatepass now knows which GitHub
 * organizations and repositories they can reach, so the org switcher has somewhere to go.
 * Re-issuing the session here would silently swap them into a different identity, which is not
 * what "connect your GitHub" means to the person clicking it.
 *
 * The API takes the account to link from the bearer token, never from the request body, so
 * this route cannot graft one person's GitHub access onto another's account even if it tried.
 */
async function linkAccount(req: NextRequest, code: string, next: string): Promise<NextResponse> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  // The session expired while the user was over on GitHub. Nothing is wrong; they sign in again.
  if (!token) return backToLogin(req, "session_expired", next);

  const url = new URL(next, req.nextUrl.origin);
  try {
    const { linked } = await new ApiClient(API_BASE, token).linkGitHub(code);
    url.searchParams.set("linked", linked.login);
  } catch (err) {
    url.searchParams.set("linkError", err instanceof ApiError && err.status === 501 ? "unavailable" : "failed");
  }
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest): Promise<Response> {
  const params = req.nextUrl.searchParams;

  // The user pressed "Cancel" on GitHub's consent screen. Not an error worth alarming about.
  if (params.get("error")) return backToLogin(req, "cancelled");

  const cookie = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
  const separator = cookie.indexOf(":");
  const expectedState = separator > 0 ? cookie.slice(0, separator) : "";
  const next = safeNextPath(separator > 0 ? cookie.slice(separator + 1) : null);

  const returnedState = params.get("state") ?? "";
  const code = params.get("code") ?? "";

  if (!expectedState || !returnedState || !sameState(expectedState, returnedState)) {
    // Either there was no sign-in in progress in this browser, or the value that came back is
    // not the one we issued. Both mean this callback was not caused by this user starting a
    // sign-in here, which is exactly the case `state` exists to refuse.
    return backToLogin(req, "state_mismatch", next);
  }
  if (!code) return backToLogin(req, "missing_code", next);

  /*
   * Two flows come back through this one callback.
   *
   * `linking` is read from `expectedState` — the value out of *our own* cookie — and only after
   * the constant-time comparison above has already established that this callback belongs to a
   * round trip this browser started here. Reading it from the returned `state`, or from a query
   * parameter, would be reading something a third party had a hand in.
   */
  if (expectedState.startsWith(LINK_STATE_PREFIX)) return await linkAccount(req, code, next);

  let token: string;
  try {
    ({ token } = await new ApiClient(API_BASE).githubCallback(code));
  } catch (err) {
    /*
     * A 403 here is not a failure — it is the deployment declining to admit this account, which
     * is a normal answer for a tool that only lets in a named org or allow-list. Collapsing it
     * into `exchange_failed` sent people to check the API's OAuth credentials when the real
     * answer was "ask someone for access", so the two are kept apart.
     */
    const denied = err instanceof ApiError && err.status === 403;
    return backToLogin(req, denied ? "not_admitted" : "exchange_failed", next);
  }

  const res = NextResponse.redirect(new URL(next, req.nextUrl.origin));
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE_SEC));
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}
