import { describe, expect, it, vi } from "vitest";
import { createSession } from "@gatepass/shared";
import { LOGIN_PATH, cookieOptions, peekSession, safeNextPath } from "../src/lib/session-cookie";

/**
 * The dashboard's half of the session.
 *
 * These three functions decide who gets through the front door, so what they must NOT do
 * matters as much as what they do:
 *
 *   - `peekSession` must never be mistaken for verification. It reads claims out of a token
 *     without checking the signature, because the HMAC key lives in the API process and the
 *     middleware runs on every navigation. A forged cookie is meant to get past it and be
 *     refused one layer in, by `requireSession()` → `GET /v1/auth/me`.
 *   - `safeNextPath` must not turn a post-login redirect into an open redirect.
 *   - `cookieOptions` must keep the token out of JavaScript's reach.
 */

const claims = { userId: "42", login: "octocat", orgId: "demo", role: "admin" as const };

describe("peekSession", () => {
  it("reads the claims out of a real session token", () => {
    const session = peekSession(createSession(claims, "any-secret"));
    expect(session).toMatchObject({ userId: "42", login: "octocat", orgId: "demo", role: "admin" });
    expect(typeof session!.exp).toBe("number");
  });

  it("rejects an expired token, so the middleware redirects instead of rendering a dead session", () => {
    expect(peekSession(createSession(claims, "s", -10))).toBeNull();
  });

  it("rejects absent, malformed and structurally wrong tokens", () => {
    expect(peekSession(undefined)).toBeNull();
    expect(peekSession("")).toBeNull();
    expect(peekSession("nodot")).toBeNull();
    expect(peekSession(".onlysignature")).toBeNull();
    expect(peekSession("bm90LWpzb24.sig")).toBeNull();
    // Well-formed JSON, but not a session — no exp and no org.
    expect(peekSession(`${Buffer.from('{"hello":1}').toString("base64url")}.sig`)).toBeNull();
  });

  /*
   * The load-bearing non-guarantee. This is deliberate: middleware answers "is there any point
   * rendering this page", and `(app)/layout.tsx` answers "is this real" by asking the API,
   * which is the only process holding the key. If this ever started returning null for a bad
   * signature it would mean the web app had gained the signing secret, which is the thing the
   * cookie design exists to avoid.
   */
  it("does NOT verify the signature — that is the API's job, and the layout's to ask", () => {
    const [payload] = createSession(claims, "the-real-secret").split(".");
    expect(peekSession(`${payload}.forged`)).not.toBeNull();
  });
});

describe("safeNextPath", () => {
  it("keeps an ordinary in-app path, query string and all", () => {
    expect(safeNextPath("/findings?tier=verified")).toBe("/findings?tier=verified");
  });

  it("refuses every shape that would make the post-login redirect an open redirect", () => {
    // `//evil.com` is protocol-relative; a browser reads it as an absolute URL.
    expect(safeNextPath("//evil.com")).toBe("/dashboard");
    expect(safeNextPath("https://evil.com")).toBe("/dashboard");
    // Some browsers normalise a backslash to a forward slash after a naive check passes.
    expect(safeNextPath("/\\evil.com")).toBe("/dashboard");
    expect(safeNextPath("evil.com")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
  });

  it("refuses to bounce back to the login page, which would loop", () => {
    expect(safeNextPath(LOGIN_PATH)).toBe("/dashboard");
    expect(safeNextPath(`${LOGIN_PATH}?next=%2Fdashboard`)).toBe("/dashboard");
  });

  it("honours an explicit fallback", () => {
    expect(safeNextPath(null, "/repos")).toBe("/repos");
  });
});

describe("cookieOptions", () => {
  it("keeps the token out of JavaScript and off cross-site requests", () => {
    const opts = cookieOptions(3600);
    expect(opts.httpOnly).toBe(true);
    // Lax rather than Strict: the OAuth callback is a top-level GET from github.com, and
    // Strict would withhold the state cookie on exactly that request.
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(3600);
  });

  /*
   * `vi.stubEnv` rather than assigning `process.env.NODE_ENV` directly: vitest defines that key
   * as a non-writable accessor, so a plain assignment throws and `Object.defineProperty` throws
   * on the way back. `unstubAllEnvs` restores it whatever this test does.
   */
  it("is Secure in production and not in development, where there is no TLS to require", () => {
    try {
      vi.stubEnv("NODE_ENV", "production");
      expect(cookieOptions(1).secure).toBe(true);
      vi.stubEnv("NODE_ENV", "development");
      expect(cookieOptions(1).secure).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
