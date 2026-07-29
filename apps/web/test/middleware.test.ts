import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPublic } from "../src/middleware";

/**
 * The gate in front of the product, asserted against the actual route tree.
 *
 * The point of reading `app/(app)/` from disk rather than listing the routes here is that a
 * hand-written list is the bug this replaced: the middleware used to name the paths it
 * *protected*, so anything absent from that list — a page added later, a typo — was served to
 * anyone, and nothing announced it. A test that also hand-lists the routes would agree with the
 * same omission and prove nothing.
 */
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "(app)");

/** Every URL path the `(app)` route group serves. Route groups are erased from the URL. */
function appRoutes(): string[] {
  return readdirSync(APP_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("[") && !e.name.startsWith("_"))
    .map((e) => `/${e.name}`);
}

describe("route gating is deny-by-default", () => {
  it("finds the product's routes on disk (guards against an empty sweep)", () => {
    const routes = appRoutes();
    expect(routes.length).toBeGreaterThan(8);
    expect(routes).toContain("/dashboard");
  });

  it("treats every page in the (app) group as private", () => {
    for (const route of appRoutes()) {
      expect(isPublic(route), `${route} must require a session`).toBe(false);
      expect(isPublic(`${route}/some-id`), `${route}/… must require a session`).toBe(false);
    }
  });

  it("keeps exactly the marketing entry points public", () => {
    expect(isPublic("/")).toBe(true);
    expect(isPublic("/login")).toBe(true);
    expect(isPublic("/opengraph-image")).toBe(true);
  });

  /*
   * The reported symptom. `/gatepass` matched no protected prefix, so it fell through to a 404
   * rendered to a signed-out visitor — which both failed to ask for a sign-in and confirmed
   * which paths do and do not exist on the deployment.
   */
  it("sends an unknown path to sign-in rather than rendering a 404 to a stranger", () => {
    for (const path of ["/gatepass", "/admin", "/.env", "/dashboardd", "/findings-old"]) {
      expect(isPublic(path), `${path} must not be public`).toBe(false);
    }
  });

  it("does not let a public path be extended into a private one", () => {
    // `/` is public; `/anything` is not, and must not inherit that by prefix matching.
    expect(isPublic("/settings")).toBe(false);
    expect(isPublic("/login/../dashboard")).toBe(false);
  });
});
