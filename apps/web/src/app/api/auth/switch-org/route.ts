import { NextResponse, type NextRequest } from "next/server";
import ApiClient from "@/lib/api-client";
import { API_BASE } from "@/lib/constants";
import { ApiError } from "@/lib/types";
import { LOGIN_PATH, SESSION_COOKIE, SESSION_MAX_AGE_SEC, cookieOptions, safeNextPath } from "@/lib/session-cookie";

/**
 * Move this browser's session to another organization the signed-in account reaches.
 *
 * POST only, and a real form in the top bar, for the same reason sign-out is: a GET that
 * changes which tenant you are looking at is triggerable by a link or an image tag on any
 * page, and silently re-pointing somebody at a different organization's security findings is
 * not something a third party should be able to do to them.
 *
 * The org id in the body is a *request*. The API re-checks it against a freshly resolved
 * GitHub grant and refuses anything the account does not actually reach, so this route does
 * not need to — and must not try to — decide the question itself. All it does is carry the new
 * token into the cookie.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.redirect(new URL(LOGIN_PATH, req.nextUrl.origin), { status: 303 });

  const form = await req.formData();
  const orgId = String(form.get("orgId") ?? "");
  // Where to land afterwards. Run through `safeNextPath` because it arrives in a form field,
  // and an open redirect is an open redirect however plausible the form looks.
  const next = safeNextPath(form.get("next") ? String(form.get("next")) : null);

  let issued: { token: string; orgId: string };
  try {
    issued = await new ApiClient(API_BASE, token).switchOrg(orgId);
  } catch (err) {
    /*
     * A refusal here is the API declining to hand out a session for an org this account does
     * not reach — the correct answer, and not something to retry or to surface as a crash. The
     * user stays where they were, which is a tenant they can definitely see.
     */
    const url = new URL(next, req.nextUrl.origin);
    url.searchParams.set("orgSwitch", err instanceof ApiError && err.status === 403 ? "denied" : "failed");
    return NextResponse.redirect(url, { status: 303 });
  }

  const res = NextResponse.redirect(new URL(next, req.nextUrl.origin), { status: 303 });
  res.cookies.set(SESSION_COOKIE, issued.token, cookieOptions(SESSION_MAX_AGE_SEC));
  return res;
}
