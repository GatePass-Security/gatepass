import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH, PATHNAME_HEADER, SESSION_COOKIE, peekSession } from "./lib/session-cookie";

/**
 * The gate in front of the product.
 *
 * Before this file existed there was no gate at all: `/dashboard`, `/findings`, `/scans`,
 * `/evidence`, `/compliance`, `/settings`, `/system` and everything else in the `(app)` route
 * group were served to anyone who knew the URL, and the org they addressed was the literal
 * `"demo"` compiled into the bundle.
 *
 * ## What this checks, and what it doesn't
 *
 * It checks that a session cookie is present and not expired. It does **not** verify the
 * signature, because the HMAC key lives in the API process and middleware runs on every
 * navigation — a network round trip here would tax each one. The authoritative check is one
 * layer in: `(app)/layout.tsx` calls `requireSession()`, which asks `GET /v1/auth/me`, and a
 * forged or revoked cookie is turned away there.
 *
 * That division is deliberate rather than a shortcut. The middleware's job is "is there any
 * point rendering this", the layout's is "is this real", and the API's is the actual security
 * boundary — every request the dashboard makes carries the bearer token and is verified by the
 * process that signed it. A cookie that passes this check and fails the next one costs an
 * attacker a redirect and buys them nothing.
 *
 * ## Redirects
 *
 * An unauthenticated request to a protected route goes to `/login?next=<where they were
 * going>`, so signing in lands the user on the page they asked for instead of dumping them on
 * the overview. An *authenticated* request to `/login` bounces to the dashboard, because a
 * sign-in form is not a useful thing to show someone who is signed in.
 */

/**
 * The only paths a signed-out visitor may reach. **Everything else needs a session.**
 *
 * This list is deliberately the inverse of what it used to be. It was a list of *protected*
 * prefixes — `/dashboard`, `/findings`, `/scans`, and ten more — which meant the default for
 * any path not written down was *public*. Its own comment claimed that naming paths avoided
 * routes silently shipping ungated, but an allow-list of protected paths is exactly that
 * failure: add a page under `(app)`, forget this file, and it serves to anyone. A typo in the
 * list had the same effect, silently.
 *
 * Denying by default inverts which mistake is possible. Forgetting to list a new public page
 * makes it ask for a sign-in — visible the first time anyone loads it, and harmless. Forgetting
 * to list a new private page used to expose it, and nothing announced that.
 *
 * It also means an unknown path (`/gatepass`, a typo, a probe) redirects to sign-in rather than
 * rendering a 404 that confirms what does and does not exist here.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/", // the marketing landing page
  LOGIN_PATH,
  "/opengraph-image", // link-preview image; no extension, so the matcher below does not skip it
]);

/** Exported so a test can assert it against the real route tree, not a copy of this list. */
export function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  const session = peekSession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === LOGIN_PATH) {
    if (!session) return NextResponse.next();
    const next = req.nextUrl.searchParams.get("next");
    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    return NextResponse.redirect(new URL(target, req.nextUrl.origin));
  }

  if (isPublic(pathname) || session) {
    /*
     * Hand the pathname down to the Server Components.
     *
     * `(app)/layout.tsx` needs it so that when it rejects a *present but invalid* cookie, it
     * can send the user back to the page they asked for rather than always to the overview.
     * Next does not expose the request path to a layout — `useParams`/`usePathname` are client
     * hooks, and the old `x-invoke-path` internal header was removed in 15 — so the middleware,
     * which does know it, sets it explicitly.
     */
    const headers = new Headers(req.headers);
    headers.set(PATHNAME_HEADER, `${pathname}${search}`);
    return NextResponse.next({ request: { headers } });
  }

  const url = new URL(LOGIN_PATH, req.nextUrl.origin);
  url.searchParams.set("next", `${pathname}${search}`);
  const res = NextResponse.redirect(url);
  // An expired or malformed cookie is cleared on the way out, so the next request is a clean
  // "signed out" rather than a loop through the same dead credential.
  if (req.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  /*
   * Skip Next's own internals, the auth and proxy route handlers, and static assets. The
   * `/api/` exclusion matters: `app/api/auth/*` is how a signed-out user signs in, and
   * `app/api/gp/*` reads the cookie itself and lets the API decide — gating either here would
   * either deadlock sign-in or duplicate a decision that belongs to the API.
   */
  matcher: ["/((?!_next/static|_next/image|api/|favicon.ico|icon.svg|landing/|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
