import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware, config as middlewareConfig } from "../src/middleware";
import { SESSION_COOKIE, STALE_SESSION_PATH, peekSession } from "../src/lib/session-cookie";

/**
 * The `/dashboard` reload loop, and the coupling that has to hold for it to stay fixed.
 *
 * ## The bug
 *
 * Two layers answered "may this request see the product?" from different evidence. The
 * middleware read the cookie's *claims* — it has no signing key and runs on every navigation,
 * so it cannot afford a round trip. `(app)/layout.tsx` asked `GET /v1/auth/me`, the only answer
 * that counts.
 *
 * A cookie whose claims parse but whose signature does not — one issued under a rotated
 * `SESSION_SECRET`, one that has been revoked, or one predating `jti` — made them disagree.
 * The layout refused it and redirected to `/login`; the middleware saw the same cookie still in
 * the browser, concluded the user was signed in, and redirected back to `/dashboard`. Nothing
 * in either response cleared the cookie, so every lap was identical: `/dashboard` → `/login` →
 * `/dashboard`, without end, which the user sees as a page that reloads forever.
 *
 * ## Why the fix is shaped the way it is
 *
 * The layer that *learns* the cookie is dead is the one layer that cannot throw it away — a
 * Server Component may not set a cookie. So the refusal is routed through a Route Handler,
 * which can. Two things make that work, and both are asserted below: the handler's path must be
 * one the middleware does not act on, and `requireSession` must actually send people to it.
 */

/** A token the middleware's `peekSession` accepts and the API would reject. */
function peekableButUnsigned(): string {
  const claims = {
    userId: "u1",
    login: "tester",
    orgId: "demo",
    role: "admin",
    jti: "j1",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const payload = Buffer.from(JSON.stringify(claims))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${payload}.notarealsignature`;
}

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3001"), {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });
}

describe("a session the API refuses does not trap the browser in a redirect loop", () => {
  it("uses a token the middleware trusts and the API would not (the premise of the bug)", () => {
    // If this ever stops being true the rest of this file is testing nothing.
    expect(peekSession(peekableButUnsigned())).not.toBeNull();
  });

  /*
   * The lap that used to close the loop. This is deliberately an assertion that the middleware
   * *still* behaves this way: the bounce is correct for a genuinely signed-in user, and it is
   * precisely why the layout may not send a cookie-holding user to `/login`.
   */
  it("still bounces /login back to the app while the cookie is present", () => {
    const res = middleware(request("/login?next=%2Fdashboard", peekableButUnsigned()));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3001/dashboard");
    // And it does not clear the cookie, so the next lap is identical to this one.
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  /*
   * The load-bearing coupling. The refusal is only escapable because the handler that clears
   * the cookie sits outside the middleware's matcher — if it were gated, the middleware would
   * see the dead cookie, wave it through to `/dashboard`, and the loop would close again one
   * hop further out.
   *
   * The pattern is read from the middleware's own exported config rather than copied, so
   * narrowing that matcher fails here instead of silently restoring the bug.
   */
  it("keeps the cookie-clearing route outside the middleware matcher", () => {
    const matcher = new RegExp(`^(?:${middlewareConfig.matcher[0]})$`);

    expect(matcher.test(STALE_SESSION_PATH), `${STALE_SESSION_PATH} must not be gated`).toBe(false);
    // Guard against a matcher so broad it excludes everything and passes the line above.
    expect(matcher.test("/dashboard")).toBe(true);
    expect(matcher.test("/login")).toBe(true);
  });

  it("lets the signed-out request through once the cookie is gone", () => {
    const res = middleware(request("/login?next=%2Fdashboard"));

    // No redirect: the login page renders, which is where the loop used to be unable to land.
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("requireSession routes a refused cookie through the handler that can clear it", () => {
  const redirected = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    redirected.mockReset();

    vi.doMock("next/headers", () => ({
      cookies: async () => ({ get: () => ({ value: peekableButUnsigned() }) }),
    }));
    vi.doMock("next/navigation", () => ({
      redirect: (url: string) => {
        redirected(url);
        // The real `redirect()` throws to abort the render; mirroring that keeps the
        // control flow under test the same as in production.
        throw new Error("NEXT_REDIRECT");
      },
    }));

    // The API refusing the cookie is the whole scenario.
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "invalid session" }), { status: 401 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("next/headers");
    vi.doUnmock("next/navigation");
  });

  it("sends the user to the clearing route, not straight back to /login", async () => {
    const { requireSession } = await import("../src/lib/session");

    await expect(requireSession("/dashboard")).rejects.toThrow("NEXT_REDIRECT");

    const target = redirected.mock.calls[0]?.[0] as string;
    expect(target).toBe(`${STALE_SESSION_PATH}?next=%2Fdashboard`);
    /*
     * The specific regression: `/login` is the one destination that cannot work here, because
     * the middleware will read the still-present cookie there and send the user back.
     */
    expect(target.startsWith("/login")).toBe(false);
  });

  it("carries the page the user asked for, so signing in returns them to it", async () => {
    const { requireSession } = await import("../src/lib/session");

    await expect(requireSession("/findings?q=sql")).rejects.toThrow("NEXT_REDIRECT");

    expect(redirected).toHaveBeenCalledWith(`${STALE_SESSION_PATH}?next=%2Ffindings%3Fq%3Dsql`);
  });

  it("refuses an off-site return path rather than forwarding it", async () => {
    const { requireSession } = await import("../src/lib/session");

    await expect(requireSession("//evil.example")).rejects.toThrow("NEXT_REDIRECT");

    expect(redirected).toHaveBeenCalledWith(`${STALE_SESSION_PATH}?next=%2Fdashboard`);
  });

  /**
   * "The API said no" and "the API did not answer" have to end differently.
   *
   * The first clears the cookie and shows the login page. The second must not redirect at all:
   * the cookie is probably fine, the middleware still accepts it, and sending the user to
   * `/login` while they hold it re-enters the very loop this file is about — this time through
   * the one door that has no dead cookie to throw away. It also throws away a working session
   * every time the API hiccups.
   */
  it("does not redirect when the API could not be reached, so an outage is not a sign-out", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const { requireSession, SessionUnavailableError } = await import("../src/lib/session");

    await expect(requireSession("/dashboard")).rejects.toThrow(SessionUnavailableError);
    expect(redirected).not.toHaveBeenCalled();
  });

  it("does not redirect when the API answers 500, either", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    const { requireSession, SessionUnavailableError } = await import("../src/lib/session");

    // A 5xx is not a statement about this cookie. Only a 401 is.
    await expect(requireSession("/dashboard")).rejects.toThrow(SessionUnavailableError);
    expect(redirected).not.toHaveBeenCalled();
  });
});
