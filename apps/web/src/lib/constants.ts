/** The Gatepass API's own origin. Server-side code and the proxy talk to this directly. */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

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
