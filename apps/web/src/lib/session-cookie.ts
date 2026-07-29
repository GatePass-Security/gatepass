/**
 * Where the dashboard's session lives, and why it lives there.
 *
 * ## The decision
 *
 * The session token is a cookie on the **web** origin (`:3001`), set and read only by
 * server-side Next.js code, and attached to API calls as `Authorization: Bearer` by the
 * same-origin proxy at `app/api/gp/[...path]`. It is `httpOnly`, `SameSite=Lax`, `Secure` in
 * production, and it is never in `localStorage`, never in a query string, and never readable
 * by any script on the page.
 *
 * ## Why not a cookie on the API origin
 *
 * `applyCors()` in `apps/api/src/server.ts` deliberately never sets
 * `access-control-allow-credentials`, and the comment there explains that this is precisely
 * what keeps reflecting an allow-listed `Origin` safe. The web app and the API are different
 * origins, so a cookie scoped to the API would simply not be sent — and "just turn on
 * credentials" would spend a security property to buy convenience. It would also mean any
 * allow-listed origin could make authenticated requests on a signed-in user's behalf.
 *
 * ## Why not `localStorage` + a header from the browser
 *
 * That is the arrangement every XSS writeup ends with. A token in `localStorage` is readable
 * by any script that gets onto the page, including one that arrives through a dependency.
 * `httpOnly` means the compromise has to ride the user's live session rather than walking off
 * with a seven-day credential.
 *
 * ## What that costs
 *
 * The browser cannot attach the token itself, so browser-initiated API calls go through the
 * Next.js proxy — one extra hop on the same origin, which also means those requests are not
 * CORS requests at all and the API's CORS posture is untouched by any of this.
 *
 * This module holds no secrets and no Node-only imports, so the Edge middleware can use it too.
 */

export const SESSION_COOKIE = "gp_session";
/** The OAuth `state` + return path, held only for the length of the round trip to GitHub. */
export const OAUTH_STATE_COOKIE = "gp_oauth_state";

export const SESSION_MAX_AGE_SEC = 7 * 24 * 3600;
export const OAUTH_STATE_MAX_AGE_SEC = 10 * 60;

/**
 * Marks an OAuth round trip as "connect this GitHub account to the session I already have"
 * rather than "sign me in".
 *
 * It lives inside the `state` value because `state` is already the thing this origin mints,
 * stores in an `httpOnly` cookie, and compares in constant time on return. Reading the mode off
 * the cookie's copy after that comparison passes makes it exactly as trustworthy as the CSRF
 * defence itself — where a `?mode=` on the callback URL would be whatever the caller sent.
 */
export const LINK_STATE_PREFIX = "link-";

/** Where an unauthenticated request is sent, carrying where it was trying to go. */
export const LOGIN_PATH = "/login";

/**
 * Where a session cookie goes to be thrown away.
 *
 * Only one layer can find out that a cookie is dead — `(app)/layout.tsx`, which asks the API —
 * and it is the one layer that cannot do anything about it: a Server Component may not set a
 * cookie, so `redirect()` leaves the dead credential in the browser. Sending the user straight
 * to `LOGIN_PATH` therefore looped, because the middleware still saw a cookie whose claims
 * parsed and bounced them back to the page that had just refused them.
 *
 * A Route Handler *can* set cookies, so the rejection is routed through one. It is under
 * `/api/`, which the middleware matcher deliberately skips — that exclusion is what keeps this
 * route reachable while carrying the very cookie the middleware would otherwise act on.
 */
export const STALE_SESSION_PATH = "/api/auth/stale";

/**
 * Request header the middleware uses to tell Server Components which path they are rendering.
 *
 * Next deliberately does not give a layout its own pathname, and the `x-invoke-path` internal
 * that used to leak it is gone in 15. `(app)/layout.tsx` needs it only for one thing: when it
 * turns away a cookie that was present but did not verify, the sign-in redirect should carry
 * the page the user actually asked for.
 */
export const PATHNAME_HEADER = "x-gatepass-pathname";

export interface SessionClaims {
  userId: string;
  login: string;
  orgId: string;
  role: "admin" | "member" | "viewer";
  exp: number;
}

/**
 * Read the claims out of a session token **without verifying the signature**.
 *
 * Deliberately not a verification function, and named so it cannot be mistaken for one. The
 * HMAC key lives in the API process, so the only place a token can actually be verified is the
 * API — which is exactly what `GET /v1/auth/me` is for, and what `requireSession()` calls on
 * every request into the app shell.
 *
 * The middleware uses this instead because it runs on every navigation and must not make a
 * network call to answer "is there any point rendering this page". A forged cookie gets past
 * *this* check and then fails at the layout, which is the correct division: the middleware is
 * a redirect, the API is the security boundary.
 */
export function peekSession(token: string | undefined): SessionClaims | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  try {
    const b64 = token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
    const claims = JSON.parse(json) as SessionClaims;
    if (typeof claims.exp !== "number" || typeof claims.orgId !== "string") return null;
    if (claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Sanitise a `next=` return path.
 *
 * Anything that is not a single-slash-rooted path is discarded, which rules out `//evil.com`
 * (protocol-relative), `https://evil.com`, and `/\evil.com` — the three shapes that turn a
 * post-login redirect into an open redirect. A backslash is rejected outright because some
 * browsers normalise it to a forward slash after the check would have passed.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (raw.startsWith(LOGIN_PATH)) return fallback;
  return raw;
}

/** Cookie attributes shared by every cookie this app sets. */
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Lax, not Strict: the OAuth callback is a top-level GET navigation from github.com, and
    // Strict would withhold the state cookie on exactly that request.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
