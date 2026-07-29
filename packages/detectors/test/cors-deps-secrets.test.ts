import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildScanContext } from "@gatepass/engine";
import { runScan } from "../src/index.js";

/**
 * Each test below is a vulnerable/clean PAIR that isolates one rule. The pairing is the point:
 * a rule that only fires on the vulnerable half is a rule about the defect, whereas a rule that
 * fires on both is a rule about the syntax they share.
 */

async function scanTree(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gp-cds-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  const ctx = await buildScanContext(dir);
  const doc = runScan(ctx, { scanId: "t", rulesetVersion: "test", executionMode: "cli", semanticEnabled: true });
  await fs.rm(dir, { recursive: true, force: true });
  return doc;
}

const has = (doc: Awaited<ReturnType<typeof scanTree>>, classId: string) =>
  doc.findings.some((f) => f.classId === classId);

describe("cors-misconfig — an emptiness check is not an allowlist", () => {
  it("flags a reflected origin guarded only by a non-emptiness test", async () => {
    const doc = await scanTree({
      "cors.go": [
        "package httpx",
        'import "net/http"',
        "func WithCORS(w http.ResponseWriter, r *http.Request) {",
        '\torigin := r.Header.Get("Origin")',
        '\tif origin != "" {',
        '\t\tw.Header().Set("Access-Control-Allow-Origin", origin)',
        '\t\tw.Header().Set("Access-Control-Allow-Credentials", "true")',
        "\t}",
        "}",
      ].join("\n"),
    });
    expect(has(doc, "cors-misconfig")).toBe(true);
  });

  it("clears the same reflection when the guard is exact membership", async () => {
    const doc = await scanTree({
      "cors.go": [
        "package httpx",
        'import "net/http"',
        'var allowed = map[string]bool{"https://app.acme.com": true}',
        "func WithCORS(w http.ResponseWriter, r *http.Request) {",
        '\torigin := r.Header.Get("Origin")',
        "\tif allowed[origin] {",
        '\t\tw.Header().Set("Access-Control-Allow-Origin", origin)',
        '\t\tw.Header().Set("Access-Control-Allow-Credentials", "true")',
        "\t}",
        "}",
      ].join("\n"),
    });
    expect(has(doc, "cors-misconfig")).toBe(false);
  });

  it("still clears a reflection compared against a concrete origin literal", async () => {
    const doc = await scanTree({
      "cors.ts": [
        'const origin = req.headers.get("origin") ?? "";',
        'if (origin === "https://app.acme.com") {',
        '  res.setHeader("Access-Control-Allow-Origin", origin);',
        '  res.setHeader("Access-Control-Allow-Credentials", "true");',
        "}",
      ].join("\n"),
    });
    expect(has(doc, "cors-misconfig")).toBe(false);
  });
});

describe("cors-misconfig — a suffix test is a suffix test in every language", () => {
  it("flags a PascalCase EndsWith origin check with a nullary AllowCredentials()", async () => {
    const doc = await scanTree({
      "Program.cs": [
        "builder.Services.AddCors(options =>",
        '    options.AddPolicy("Partners", policy =>',
        "        policy",
        "            .SetIsOriginAllowed(origin =>",
        "            {",
        "                var host = new Uri(origin).Host;",
        '                return host.EndsWith("contoso.com", StringComparison.OrdinalIgnoreCase);',
        "            })",
        "            .AllowAnyHeader()",
        "            .AllowCredentials()));",
      ].join("\n"),
    });
    const f = doc.findings.find((x) => x.classId === "cors-misconfig");
    expect(f).toBeTruthy();
    // The nullary builder call is the credentials declaration, so this is not a medium.
    expect(f?.severity).toBe("high");
  });

  it("does not read a collection membership test as a suffix test", async () => {
    const doc = await scanTree({
      "Program.cs": [
        'string[] AllowedOrigins = { "https://app.contoso.com" };',
        "builder.Services.AddCors(options =>",
        '    options.AddPolicy("Partners", policy =>',
        "        policy",
        "            .SetIsOriginAllowed(origin => AllowedOrigins.Contains(origin))",
        "            .AllowCredentials()));",
      ].join("\n"),
    });
    expect(has(doc, "cors-misconfig")).toBe(false);
  });
});

describe("cors-misconfig — a test's name is prose, not a policy", () => {
  it("does not flag a header name quoted inside a test title", async () => {
    const doc = await scanTree({
      "src/app.ts": 'app.use(cors({ origin: "https://app.acme.com", credentials: true }));',
      "test/cors.test.ts": [
        'import { describe, expect, it } from "vitest";',
        'describe("CORS policy", () => {',
        '  it("never pairs Access-Control-Allow-Origin: * with credentials", async () => {',
        "    expect(forbidden).toBe(false);",
        "  });",
        "});",
      ].join("\n"),
    });
    expect(has(doc, "cors-misconfig")).toBe(false);
  });

  it("still flags a real policy that sits in the same file as test titles", async () => {
    const doc = await scanTree({
      "test/server.test.ts": [
        'import { describe, it } from "vitest";',
        'describe("server", () => {',
        '  it("boots", () => {});',
        "});",
        'res.setHeader("Access-Control-Allow-Origin", "*");',
        'res.setHeader("Access-Control-Allow-Credentials", "true");',
      ].join("\n"),
    });
    expect(has(doc, "cors-misconfig")).toBe(true);
  });
});

describe("cors-misconfig — an nginx map is an allowlist", () => {
  const site = (variable: string) =>
    [
      "server {",
      "    location /api/ {",
      `        add_header Access-Control-Allow-Origin      ${variable} always;`,
      '        add_header Access-Control-Allow-Credentials "true" always;',
      "        proxy_pass http://api_upstream;",
      "    }",
      "}",
    ].join("\n");

  it("clears an echo bounded by exact-match map keys with an empty default", async () => {
    const doc = await scanTree({
      "conf.d/cors_map.conf": [
        "map $http_origin $api_allow_origin {",
        '    default                     "";',
        '    "https://app.example.com"   $http_origin;',
        '    "https://admin.example.com" $http_origin;',
        "}",
      ].join("\n"),
      "conf.d/site.conf": site("$api_allow_origin"),
    });
    expect(has(doc, "cors-misconfig")).toBe(false);
  });

  it("flags the same echo when the map default emits the request origin", async () => {
    const doc = await scanTree({
      "conf.d/cors_map.conf": ["map $http_origin $cors_origin {", "    default $http_origin;", '    ""      "";', "}"].join(
        "\n",
      ),
      "conf.d/site.conf": site("$cors_origin"),
    });
    expect(has(doc, "cors-misconfig")).toBe(true);
  });

  it("flags a map whose keys are regular expressions rather than exact origins", async () => {
    const doc = await scanTree({
      "conf.d/cors_map.conf": [
        "map $http_origin $api_allow_origin {",
        '    default                    "";',
        "    ~^https://.*\\.example\\.com$  $http_origin;",
        "}",
      ].join("\n"),
      "conf.d/site.conf": site("$api_allow_origin"),
    });
    expect(has(doc, "cors-misconfig")).toBe(true);
  });
});

describe("unpinned-dependency — Cargo manifests", () => {
  it("flags a wildcard requirement and a branch-tracking git dependency", async () => {
    const doc = await scanTree({
      "Cargo.toml": [
        "[package]",
        'name = "ledger-sync"',
        "",
        "[dependencies]",
        'serde_json = "*"',
        'tenant-audit = { git = "https://github.com/acme/tenant-audit", branch = "main" }',
      ].join("\n"),
    });
    const found = doc.findings.filter((f) => f.classId === "unpinned-dependency");
    expect(found).toHaveLength(2);
  });

  it("clears rev-pinned and tag-pinned git dependencies and plain compatible ranges", async () => {
    const doc = await scanTree({
      "Cargo.toml": [
        "[package]",
        'name = "ledger-sync"',
        "",
        "[dependencies]",
        'anyhow = "1.0"',
        'axum = "0.7"',
        'tokio = { version = "1", features = ["macros"] }',
        'pinned = { git = "https://github.com/acme/pinned", rev = "0123456789abcdef0123456789abcdef01234567" }',
        'tagged = { git = "https://github.com/acme/tagged", tag = "v1.2.3" }',
        'local = { path = "../local" }',
        "",
        "[dev-dependencies]",
        'tower = { version = "0.4", features = ["util"] }',
      ].join("\n"),
    });
    expect(has(doc, "unpinned-dependency")).toBe(false);
  });

  it("flags a git dependency with no ref at all", async () => {
    const doc = await scanTree({
      "Cargo.toml": ["[dependencies]", 'shared = { git = "https://github.com/acme/shared" }'].join("\n"),
    });
    expect(has(doc, "unpinned-dependency")).toBe(true);
  });
});

describe("unpinned-dependency — bounded vs unbounded, not lockfile presence", () => {
  it("does not flag bounded caret ranges in a library with no committed lockfile", async () => {
    const doc = await scanTree({
      "package.json": JSON.stringify(
        {
          name: "housekeeping",
          bin: { housekeeping: "index.js" },
          dependencies: { "@modelcontextprotocol/sdk": "^1.0.0", zod: "^3.23.0" },
        },
        null,
        2,
      ),
    });
    expect(has(doc, "unpinned-dependency")).toBe(false);
  });

  it("does not flag a bounded pre-1.0 caret or tilde either", async () => {
    const doc = await scanTree({
      "package.json": JSON.stringify({ dependencies: { sdk: "^0.5.0", parser: "~0.9.1", legacy: "1.x" } }, null, 2),
    });
    expect(has(doc, "unpinned-dependency")).toBe(false);
  });

  it("still flags specifiers with no upper bound", async () => {
    const doc = await scanTree({
      "package.json": JSON.stringify({ dependencies: { a: "*", b: "latest", c: ">=1.2.3" } }, null, 2),
    });
    expect(doc.findings.filter((f) => f.classId === "unpinned-dependency")).toHaveLength(3);
  });

  it("still flags a git dependency with no ref while accepting a release tag", async () => {
    const doc = await scanTree({
      "package.json": JSON.stringify(
        {
          dependencies: {
            floating: "git+https://github.com/acme/tools.git",
            pinned: "git+https://github.com/acme/tools.git#v1.2.3",
          },
        },
        null,
        2,
      ),
    });
    const found = doc.findings.filter((f) => f.classId === "unpinned-dependency");
    expect(found).toHaveLength(1);
    expect(found[0]!.explanation).toContain("floating");
  });

  it("accepts a release-tag action ref, which is the ordinary correct form", async () => {
    const doc = await scanTree({
      ".github/workflows/ci.yml": ["jobs:", "  test:", "    steps:", "      - uses: actions/checkout@v4"].join("\n"),
    });
    expect(has(doc, "unpinned-dependency")).toBe(false);
  });
});

describe("exposed-secret — a PEM delimiter is not key material", () => {
  it("does not flag a BEGIN marker used as a placeholder, a format check or an invalid fixture", async () => {
    const doc = await scanTree({
      "src/schema.ts": [
        "export const tlsClientKeyField = {",
        '  placeholder: "Begins with -----BEGIN RSA PRIVATE KEY-----",',
        "};",
        "export function isPemFormatted(value: string): boolean {",
        '  return value.startsWith("-----BEGIN PRIVATE KEY-----");',
        "}",
        'export const invalidKey = "-----BEGIN PRIVATE KEY-----\\nnot-a-valid-key\\n-----END PRIVATE KEY-----";',
      ].join("\n"),
    });
    expect(has(doc, "exposed-secret")).toBe(false);
  });

  it("flags a PEM block that carries a real base64 body", async () => {
    const body = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ" + "A".repeat(200);
    const doc = await scanTree({
      "config/key.pem.ts": `export const k = "-----BEGIN PRIVATE KEY-----\\n${body}\\n-----END PRIVATE KEY-----";`,
    });
    expect(has(doc, "exposed-secret")).toBe(true);
  });

  it("flags a key inlined into JSON with escaped newlines", async () => {
    const body = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ" + "A".repeat(200);
    const doc = await scanTree({
      "config/sa.json": JSON.stringify({ private_key: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n` }),
    });
    expect(has(doc, "exposed-secret")).toBe(true);
  });
});

describe("exposed-secret — a value that denies being a credential", () => {
  it("does not flag a self-negating password in a compose file or its DSN", async () => {
    const doc = await scanTree({
      "docker-compose.yml": [
        "services:",
        "  api:",
        "    environment:",
        "      DATABASE_URL: postgres://app:not-a-real-password@db:5432/app",
        "  db:",
        "    environment:",
        "      POSTGRES_PASSWORD: not-a-real-password",
      ].join("\n"),
    });
    expect(has(doc, "exposed-secret")).toBe(false);
  });

  it("still flags an opaque password in the same position", async () => {
    const doc = await scanTree({
      "docker-compose.yml": [
        "services:",
        "  api:",
        "    environment:",
        "      DATABASE_URL: postgres://orders_rw:hV3xQ8pLm2Zr9Tc4@prod-db.acme.internal:5432/orders",
      ].join("\n"),
    });
    expect(has(doc, "exposed-secret")).toBe(true);
  });

  it("does not let self-negation clear an issuer-formatted key, whose alphabet cannot spell it", async () => {
    const doc = await scanTree({ "dist/bundle.js": 'var k = "AKIAFAKE7Q3XZ9J4M8K2";' });
    expect(has(doc, "exposed-secret")).toBe(true);
  });
});

describe("exposed-secret — Slack tokens are structured", () => {
  it("flags a token carrying the numeric team id", async () => {
    const doc = await scanTree({ ".env.production": "SLACK_BOT_TOKEN=xoxb-123456789-AbCdEfGhIj" });
    expect(has(doc, "exposed-secret")).toBe(true);
  });

  it("does not flag a prefix-only stand-in with no team id", async () => {
    const doc = await scanTree({ "src/client.ts": 'const mockToken = "xoxb-test-token-for-local";' });
    expect(has(doc, "exposed-secret")).toBe(false);
  });
});
