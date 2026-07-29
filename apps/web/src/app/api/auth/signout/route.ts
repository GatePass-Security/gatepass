import { NextResponse, type NextRequest } from "next/server";
import ApiClient from "@/lib/api-client";
import { API_BASE } from "@/lib/constants";
import { LOGIN_PATH, OAUTH_STATE_COOKIE, SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Sign out: withdraw the token, then clear the cookie and land on the login page.
 *
 * POST only. A GET sign-out is triggerable by any image tag on any page, which makes logging
 * a user out a thing a third party can do to them; the sign-out control in the top bar is a
 * real form so it stays a deliberate act.
 *
 * Clearing the cookie only ever ended *this browser's* access. The token is a stateless signed
 * blob, so a copy taken off the wire or left on a shared machine stayed valid for the rest of
 * its seven days and nobody could stop it. So this now tells the API to revoke the token's
 * `jti` as well, which is what makes signing out mean something on every other machine too.
 *
 * The cookie is cleared even when that call fails. A sign-out that leaves the user apparently
 * signed in because the API was briefly unreachable is the worse failure of the two — the
 * revocation can be retried, a confusing session cannot be un-had.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await new ApiClient(API_BASE, token).signOut();
    } catch {
      // Deliberately swallowed — see above. The cookie still goes.
    }
  }
  const res = NextResponse.redirect(new URL(LOGIN_PATH, req.nextUrl.origin), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}
