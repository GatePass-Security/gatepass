/**
 * The Gatepass API's own origin. **Server-side only.**
 *
 * ## Why this is not a `NEXT_PUBLIC_` value
 *
 * Nothing in the browser needs it. The browser talks to `API_PROXY_BASE` below — a same-origin
 * path — and the proxy is the only thing that dials the API. So publishing the API's origin
 * into the client bundle bought nothing and cost two things:
 *
 *  - **It is frozen at build time.** Next.js inlines `NEXT_PUBLIC_*` into the compiled output,
 *    so setting it on the host after a deploy changes nothing until the next build. Read at
 *    runtime, an edited environment variable takes effect on restart, which is what an operator
 *    expects when they fix a URL.
 *  - **It shipped the API's address to every visitor**, including on the signed-out marketing
 *    pages, for no functional reason.
 *
 * `NEXT_PUBLIC_API_URL` is still honoured so an existing deployment configured the documented
 * way keeps working; `GATEPASS_API_URL` is the one to set now.
 */
const configured = (process.env.GATEPASS_API_URL || process.env.NEXT_PUBLIC_API_URL || "").trim();

/**
 * Whether an API origin was actually configured, as opposed to defaulted.
 *
 * The localhost default is right for `pnpm dev` and actively misleading anywhere else: a hosted
 * dashboard with no API URL set would dial its own loopback, get nothing, and report that the
 * API "isn't running on this machine" — sending an operator to restart a local process that was
 * never the problem. Callers use this to say the true thing instead.
 */
export const API_BASE_CONFIGURED = configured.length > 0;

/** Trailing slashes are stripped so `${API_BASE}/v1/...` cannot produce a double slash. */
export const API_BASE = (configured || "http://localhost:3000").replace(/\/+$/, "");

/**
 * True when this build was deployed without being told where its API lives.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so a deployment that never set
 * `NEXT_PUBLIC_API_URL` ships `http://localhost:3000` compiled into the browser bundle. Every
 * request then resolves to the *visitor's own machine*, and the failure is indistinguishable from
 * an outage — which is exactly how it was reported: a page telling a visitor "no response from
 * http://localhost:3000, start the API and reload". They cannot start it, it is not their API, and
 * nothing was wrong with the server.
 *
 * A page served from a real host while pointing at loopback cannot be anything but a configuration
 * error, so it is worth naming as one. Deliberately not a build-time throw: the landing page is
 * fully functional without an API, and failing the build would take a working marketing site down
 * to protect a route the visitor may never open.
 */
export function apiUrlMisconfigured(): boolean {
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/;
  let apiIsLoopback: boolean;
  try {
    apiIsLoopback = loopback.test(new URL(API_BASE).hostname);
  } catch {
    return false;
  }
  if (!apiIsLoopback) return false;

  /*
   * In the browser the page's own origin settles it: served from a real host, pointing at
   * loopback. On the server there is no location to compare against — and the pages that show
   * this are server-rendered — so fall back to the condition that produced the loopback default
   * in the first place. `next dev` is excluded because there the default is correct.
   *
   * The test is "was anything configured", not "was NEXT_PUBLIC_API_URL configured". Someone
   * self-hosting both halves on one box can legitimately point `GATEPASS_API_URL` at loopback,
   * and telling them their deployment is misconfigured because they set the current variable
   * rather than the deprecated one would be a false alarm about a correct setup.
   */
  if (typeof window !== "undefined") return !loopback.test(window.location.hostname);
  return process.env.NODE_ENV === "production" && !API_BASE_CONFIGURED;
}

/**
 * What the **browser** talks to: a same-origin path handled by `app/api/gp/[...path]`, which
 * attaches the session bearer server-side and forwards to `API_BASE`.
 *
 * The session cookie is `httpOnly` on this origin, so no script can read it and no script can
 * set an `Authorization` header from it. Routing browser traffic through here is what lets the
 * dashboard make authenticated calls without ever handing the token to JavaScript — and it
 * leaves the API's CORS posture alone, because a same-origin request is not a CORS request.
 * See `lib/session-cookie.ts` for the full reasoning.
 */
export const API_PROXY_BASE = "/api/gp";

/**
 * `ORG_ID` used to live here as the literal `"demo"`, imported by thirteen pages. It is gone:
 * the org now comes from the verified session (`lib/session.ts` on the server,
 * `useOrgId()` from `providers/SessionProvider` on the client), so the dashboard shows the
 * tenant the signed-in user actually belongs to rather than a constant compiled into the
 * bundle.
 */
