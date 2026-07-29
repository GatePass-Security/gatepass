import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import ApiClient from "@/lib/api-client";
import { API_BASE } from "@/lib/constants";
import {
  LINK_STATE_PREFIX,
  LOGIN_PATH,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SEC,
  cookieOptions,
  safeNextPath,
} from "@/lib/session-cookie";

/**
 * Begin GitHub sign-in.
 *
 * Mints the OAuth `state`, records it in a short-lived `httpOnly` cookie together with where
 * the user was heading, and redirects to GitHub.
 *
 * The `state` was previously passed straight through from the caller and never checked on the
 * way back, which is a CSRF hole in the login flow: an attacker who can get a victim's browser
 * to hit the callback with the attacker's own `code` logs the victim into the *attacker's*
 * account, and anything the victim then does happens in a session someone else controls.
 * Binding the value to a cookie only this origin can set — and comparing it in constant time
 * on return — is what closes it.
 *
 * The return path rides in the cookie rather than in `state` itself. `state` comes back through
 * a third party, so anything carried in it is attacker-influenced; a path taken from there and
 * redirected to is an open redirect. The cookie never leaves this origin.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const next = safeNextPath(req.nextUrl.searchParams.get("next"));
  /*
   * `?mode=link` means "attach GitHub to the session I already have" rather than "sign me in".
   *
   * It is carried in the `state` value itself rather than in a second cookie or a query
   * parameter on the callback. `state` is already minted here, already stored in an `httpOnly`
   * cookie only this origin can set, and already compared in constant time on return — so the
   * callback can read the mode off the *cookie's* copy after that comparison has succeeded, and
   * it is exactly as trustworthy as the CSRF defence it rides on. A `?mode=` on the callback
   * URL, by contrast, would be attacker-supplied.
   */
  const linking = req.nextUrl.searchParams.get("mode") === "link";
  const state = `${linking ? LINK_STATE_PREFIX : ""}${randomUUID()}`;

  let authorizeUrl: string;
  try {
    ({ url: authorizeUrl } = await new ApiClient(API_BASE).githubLoginUrl(state));
  } catch {
    // The API has no OAuth credentials, or is unreachable. Send the user back to the login
    // page, which renders what this deployment can actually do rather than a raw failure.
    return NextResponse.redirect(new URL(`${LOGIN_PATH}?error=github_unavailable`, req.nextUrl.origin));
  }

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(OAUTH_STATE_COOKIE, `${state}:${next}`, cookieOptions(OAUTH_STATE_MAX_AGE_SEC));
  return res;
}
