import { NextResponse, type NextRequest } from "next/server";
import ApiClient from "@/lib/api-client";
import { API_BASE } from "@/lib/constants";
import { LOGIN_PATH, SESSION_COOKIE, safeNextPath } from "@/lib/session-cookie";

/**
 * Discard a session cookie the API has refused, then send the user to sign in.
 *
 * ## Why this route exists
 *
 * Two layers decide whether a request may see the product, and they know different things.
 * `middleware.ts` reads the cookie's claims without verifying them — it has no signing key and
 * runs on every navigation, so it cannot afford a round trip. `(app)/layout.tsx` asks
 * `GET /v1/auth/me`, which is the only answer that counts.
 *
 * When those two disagree — the claims parse, the signature does not — the layout redirects to
 * `/login`, the middleware sees the same still-present cookie, believes the user is signed in,
 * and redirects back. Neither response clears the cookie, so nothing about the next attempt is
 * different: `/dashboard` → `/login` → `/dashboard`, forever, which the browser shows as a page
 * that reloads without end.
 *
 * The layout cannot break that cycle itself. A Server Component may not set cookies, so the one
 * layer that learns the cookie is dead is the one layer that cannot throw it away. A Route
 * Handler can, so the rejection is routed through here: the cookie goes, and the request that
 * follows is an ordinary signed-out one.
 *
 * ## Why it re-checks instead of just clearing
 *
 * A `GET` that unconditionally deletes the session cookie is a sign-out any third party can
 * trigger with an `<img>` tag — the exact reason `../signout` is `POST` only. So this asks the
 * API whether the cookie is actually dead and only clears it if it is. Reached with a working
 * session, it does nothing but forward, which makes it useless as a way to log someone out.
 *
 * The extra round trip is paid once, on a session that is already broken, and never on a
 * healthy navigation.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const next = safeNextPath(req.nextUrl.searchParams.get("next"));
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (token) {
    let session = null;
    try {
      session = await new ApiClient(API_BASE, token).session(token);
    } catch {
      /*
       * The API did not answer this time. Fall through and clear.
       *
       * That looks like the wrong direction — everywhere else, "could not ask" must not be
       * treated as an answer — but this route is only ever reached *after* the layout got a
       * definitive 401 (`requireSession` renders an outage rather than redirecting here). The
       * last thing the API actually said about this cookie was no. Keeping it on the strength
       * of a failed second opinion would send the user back to a layout that will refuse them
       * again, and round we go; clearing costs them one sign-in and ends it.
       */
    }
    // Still good — whoever sent the user here was wrong, or it was not the user who sent them.
    // Either way the cookie is not ours to throw away.
    if (session) return NextResponse.redirect(new URL(next, req.nextUrl.origin), { status: 303 });
  }

  const url = new URL(LOGIN_PATH, req.nextUrl.origin);
  url.searchParams.set("next", next);
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
