import { NextResponse, type NextRequest } from "next/server";
import ApiClient from "@/lib/api-client";
import { API_BASE } from "@/lib/constants";
import { ApiError } from "@/lib/types";
import { LOGIN_PATH, SESSION_COOKIE, cookieOptions, safeNextPath } from "@/lib/session-cookie";

/**
 * Local password sign-in.
 *
 * Like the dev route beside it, this holds **no** authorization logic of its own: it forwards
 * the credentials to the API and stores whatever session comes back. Whether the account exists,
 * whether the password matches, how many attempts are left — all of that is the API's
 * (`passwordSignIn` in `apps/api/src/handlers.ts`, rate-limited in `server.ts`), so the answer
 * cannot be changed by editing the front end.
 *
 * ## Why a form POST rather than fetch
 *
 * The password is submitted by the browser and never enters client JavaScript, so no page
 * script — including one that arrived through a dependency — is in a position to read it as it
 * is typed or sent. It also means the session cookie is set on a top-level navigation, which is
 * the one case `SameSite=Lax` allows.
 *
 * ## Why failures do not say which part was wrong
 *
 * They cannot: the API returns one message for "no such account" and "wrong password", so there
 * is nothing here to leak even by accident. This route only distinguishes *refused* from *rate
 * limited*, because the second is the one where the useful advice is "wait", not "try again".
 *
 * The submitted username is deliberately not echoed back into the URL. It would be a
 * credential-shaped value in browser history, in the referrer of every asset the login page
 * loads, and in any proxy log along the way.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(req: NextRequest, error: string, next: string): NextResponse {
  const url = new URL(LOGIN_PATH, req.nextUrl.origin);
  url.searchParams.set("error", error);
  if (next !== "/dashboard") url.searchParams.set("next", next);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: NextRequest): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const next = safeNextPath(typeof form?.get("next") === "string" ? String(form.get("next")) : null);
  const login = typeof form?.get("login") === "string" ? String(form.get("login")) : "";
  const password = typeof form?.get("password") === "string" ? String(form.get("password")) : "";

  if (!login || !password) return back(req, "bad_credentials", next);

  try {
    const { token } = await new ApiClient(API_BASE).passwordSignIn(login, password);
    const res = NextResponse.redirect(new URL(next, req.nextUrl.origin), { status: 303 });
    // A day, matching the API's TTL for a local session. A cookie that outlives the token it
    // carries just produces a confusing round trip through the stale-session handler.
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(24 * 3600));
    return res;
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) return back(req, "too_many_attempts", next);
    if (err instanceof ApiError && err.status === 501) return back(req, "password_unavailable", next);
    return back(req, "bad_credentials", next);
  }
}
