import { NextResponse, type NextRequest } from "next/server";
import { API_BASE } from "@/lib/constants";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Same-origin proxy to the Gatepass API, adding this request's session bearer.
 *
 * This is the piece that makes an `httpOnly` session workable for a dashboard built out of
 * Client Components. The browser calls `/api/gp/v1/...` — same origin, so no CORS, no
 * credentials flag, no change to the API's deliberately credential-free CORS posture — and
 * this handler reads the cookie the browser cannot and forwards the token as
 * `Authorization: Bearer`.
 *
 * The alternative shapes were both worse. A token in `localStorage` is readable by any script
 * that reaches the page. A cookie on the API origin would require
 * `access-control-allow-credentials`, and the comment on `applyCors()` in
 * `apps/api/src/server.ts` explains exactly why that header staying unset is what makes
 * reflecting an allow-listed origin safe.
 *
 * ## What is deliberately NOT forwarded
 *
 * The client's `Authorization` header. Whatever a browser sends is discarded and replaced with
 * the cookie's token — a proxy that let a caller supply its own bearer would be a way to
 * bypass the cookie rather than a way to use it. `X-Org-Id` is dropped for the same reason:
 * the API derives the org from the session, and a header a page could set has no business
 * competing with that.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Request headers worth passing through. Everything else is either hop-by-hop or ours to set. */
const FORWARD_REQUEST_HEADERS = ["content-type", "accept"];
/** Response headers worth passing back. `retry-after` carries the API's rate-limit answer. */
const FORWARD_RESPONSE_HEADERS = ["content-type", "retry-after", "x-ratelimit-remaining", "x-ratelimit-reset"];

/**
 * Long enough for `POST /orgs/:org/scan-remote`, which clones a repository. The client sets
 * its own 180s budget for that call; this is the outer bound so a wedged upstream cannot pin
 * a Next.js worker indefinitely.
 */
const UPSTREAM_TIMEOUT_MS = 190_000;

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  // `path` is already decoded per-segment by Next, and a repo name travels as one encoded
  // segment (`owner%2Fname`), so it has to be re-encoded or the API sees two segments.
  const suffix = path.map(encodeURIComponent).join("/");
  const url = `${API_BASE}/${suffix}${req.nextUrl.search}`;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (token) headers.set("authorization", `Bearer ${token}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    /*
     * The API is unreachable. Answering 502 with this exact phrase is what lets
     * `lib/errors.ts` recognise it and show "Can't reach the Gatepass API" — the same
     * message a direct browser-to-API request used to produce as a `TypeError`. Without it,
     * a stopped API would read as "the API hit an error", which points at the wrong thing.
     */
    return NextResponse.json({ error: `upstream API unreachable at ${API_BASE}` }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  const out = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
