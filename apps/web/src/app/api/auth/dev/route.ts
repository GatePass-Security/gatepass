import { NextResponse, type NextRequest } from "next/server";
import ApiClient from "@/lib/api-client";
import { API_BASE } from "@/lib/constants";
import { SESSION_COOKIE, cookieOptions, safeNextPath } from "@/lib/session-cookie";

/**
 * Local development sign-in.
 *
 * This route holds **no** authorization logic of its own — it asks the API for a dev session
 * and stores whatever it gets. The API refuses unless the deployment explicitly opted in AND
 * `NODE_ENV` is not production (`apps/api/src/auth.ts`, `devAuthEnabled`), so the guard lives
 * in one place and cannot be satisfied by editing the front end. A 403 here means the door is
 * shut, and the login page says so.
 *
 * Everything downstream of it — the cookie, the proxy, the middleware, `/v1/auth/me`, the role
 * checks — is the same code the GitHub flow uses. The session is real and signed; only the
 * question of who vouched for the user is different.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const next = safeNextPath(typeof form?.get("next") === "string" ? String(form.get("next")) : null);
  const login = typeof form?.get("login") === "string" ? String(form.get("login")).trim() : "";

  try {
    const { token } = await new ApiClient(API_BASE).devSession(login || undefined);
    const res = NextResponse.redirect(new URL(next, req.nextUrl.origin), { status: 303 });
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(12 * 3600));
    return res;
  } catch {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("error", "dev_unavailable");
    if (next !== "/dashboard") url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }
}
