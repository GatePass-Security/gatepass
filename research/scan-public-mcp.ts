import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildScanContext } from "@gatepass/engine";
import { runScan } from "@gatepass/detectors";
import { asiForClass, ASI_CATEGORIES, type AsiId } from "@gatepass/findings";

/**
 * "State of MCP Security" — mass static scan of real, public MCP server repositories.
 *
 * Discovers public MCP servers via the GitHub search API, shallow-clones each, runs the
 * deterministic Gatepass engine, and aggregates findings by OWASP ASI (2026) category.
 *
 *   pnpm research:scan-mcp -- --limit 200
 *
 * Method notes (these matter for publication):
 * - Only VERIFIED-tier findings are counted in headline statistics. Verified findings carry a
 *   machine-checked reproduction (file + line that provably exists), so every number in the
 *   report is traceable to a specific line of public code.
 * - Vendored/generated paths are excluded from repo-level statistics to avoid counting a
 *   dependency's problems against the repo (see EXCLUDED).
 * - Raw per-repo results are written alongside the aggregate so anyone can re-derive the
 *   numbers or re-scan the same commit SHAs.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "out");

const EXCLUDED = /(^|\/)(node_modules|\.git|dist|build|\.next|vendor|third_party|site-packages)(\/|$)/;

/**
 * Test, example, and documentation paths. A hardcoded key in a test fixture or a deliberately
 * insecure sample in a tutorial is NOT a production vulnerability, and counting it as one is the
 * fastest way to have a security report dismissed. We classify rather than discard: production
 * counts drive the headline, test/example counts are reported separately.
 */
const TEST_PATH =
  /(^|\/)(test|tests|__tests__|__mocks__|spec|specs|e2e|fixtures?|examples?|example|demo|demos|docs?|samples?|playground|benchmark)(\/|$)|\.(test|spec)\.[a-z]+$|_test\.[a-z]+$|\.stories\.[a-z]+$/i;

interface RepoRef {
  fullName: string;
  url: string;
  stars: number;
  pushedAt: string;
}

interface RepoResult {
  repo: string;
  stars: number;
  sha: string;
  filesScanned: number;
  verified: number;
  research: number;
  byClass: Record<string, number>;
  byAsi: Record<string, number>;
  /** Findings located in production code only — the basis for headline claims. */
  verifiedProd: number;
  byClassProd: Record<string, number>;
  byAsiProd: Record<string, number>;
  /** Findings located in test/example/docs paths, reported separately. */
  verifiedTest: number;
  /** One example location per class, for spot-checking the report. */
  samples: { classId: string; asi: AsiId[]; path: string; line?: number; isTest: boolean }[];
  error?: string;
}

function run(
  cmd: string,
  args: string[],
  cwd?: string,
  timeoutMs = 120_000,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      resolve({ code: err ? 1 : 0, stdout: stdout ?? "" });
    });
  });
}

/** Discover public MCP server repos via the GitHub search API (uses `gh` for auth). */
async function discoverRepos(limit: number): Promise<RepoRef[]> {
  const queries = [
    "mcp-server in:name,description,topics",
    "topic:mcp-server",
    "topic:model-context-protocol",
    '"@modelcontextprotocol/sdk" in:file filename:package.json',
    '"modelcontextprotocol" in:name,description',
  ];
  const seen = new Map<string, RepoRef>();

  for (const q of queries) {
    if (seen.size >= limit) break;
    // 100 per page is the API max; a few pages per query is plenty for a few hundred repos.
    for (let page = 1; page <= 3 && seen.size < limit; page++) {
      const { code, stdout } = await run("gh", [
        "api",
        "-X",
        "GET",
        "search/repositories",
        "-f",
        `q=${q}`,
        "-f",
        "sort=stars",
        "-f",
        "order=desc",
        "-f",
        "per_page=100",
        "-f",
        `page=${page}`,
      ]);
      if (code !== 0) break;
      let json: { items?: { full_name: string; clone_url: string; stargazers_count: number; pushed_at: string }[] };
      try {
        json = JSON.parse(stdout);
      } catch {
        break;
      }
      const items = json.items ?? [];
      if (items.length === 0) break;
      for (const it of items) {
        if (seen.size >= limit) break;
        if (!seen.has(it.full_name)) {
          seen.set(it.full_name, {
            fullName: it.full_name,
            url: it.clone_url,
            stars: it.stargazers_count,
            pushedAt: it.pushed_at,
          });
        }
      }
    }
  }
  return [...seen.values()];
}

/**
 * Confirm the repo is actually an MCP server implementation, not a list/aggregator that merely
 * mentions MCP. Publishing "we scanned N MCP servers" requires that N really are MCP servers —
 * an awesome-list or a general workflow tool in the denominator would invalidate the headline.
 */
const MCP_EVIDENCE =
  /@modelcontextprotocol\/sdk|modelcontextprotocol|mcp\.server|McpServer|FastMCP|from\s+mcp\b|import\s+mcp\b|"mcp"\s*:|StdioServerTransport|SSEServerTransport|list_tools|tools\/call/i;

function isMcpServer(files: readonly { relPath: string; content: string }[]): boolean {
  let manifestHit = false;
  let codeHit = false;
  for (const f of files) {
    if (/(^|\/)(package\.json|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml)$/i.test(f.relPath)) {
      if (MCP_EVIDENCE.test(f.content)) manifestHit = true;
    } else if (/\.(ts|tsx|js|mjs|py|go|rs)$/i.test(f.relPath)) {
      if (MCP_EVIDENCE.test(f.content)) codeHit = true;
    }
    if (manifestHit && codeHit) return true;
  }
  // A declared SDK dependency alone is sufficient; a stray code mention alone is not.
  return manifestHit;
}

async function scanRepo(repo: RepoRef, workRoot: string): Promise<RepoResult> {
  const dir = path.join(workRoot, repo.fullName.replace("/", "__"));
  const base: RepoResult = {
    repo: repo.fullName,
    stars: repo.stars,
    sha: "",
    filesScanned: 0,
    verified: 0,
    research: 0,
    byClass: {},
    byAsi: {},
    verifiedProd: 0,
    byClassProd: {},
    byAsiProd: {},
    verifiedTest: 0,
    samples: [],
  };

  // Blobless partial clone keeps very large repos (monorepos, CLIs) inside the time budget.
  const clone = await run(
    "git",
    ["clone", "--depth", "1", "--filter=blob:none", "--quiet", repo.url, dir],
    undefined,
    300_000,
  );
  if (clone.code !== 0) return { ...base, error: "clone failed" };

  try {
    const rev = await run("git", ["rev-parse", "HEAD"], dir);
    base.sha = rev.stdout.trim();

    const ctx = await buildScanContext(dir);
    // Exclude vendored/generated trees so a repo isn't charged for its dependencies.
    const files = ctx.files.filter((f) => !EXCLUDED.test(f.relPath));

    if (!isMcpServer(files)) return { ...base, error: "not-an-mcp-server" };

    const scoped = { ...ctx, files };
    base.filesScanned = files.length;

    const doc = runScan(scoped, {
      scanId: `mcp-survey:${repo.fullName}`,
      rulesetVersion: "corpus-v1",
      executionMode: "cli",
      semanticEnabled: false, // deterministic only — no LLM in the published numbers
    });

    // Deduplicate by fingerprint so a repeated pattern in one file is not counted many times.
    const seenFingerprints = new Set<string>();
    for (const f of doc.findings) {
      if (seenFingerprints.has(f.fingerprint)) continue;
      seenFingerprints.add(f.fingerprint);
      if (f.tier === "verified") base.verified++;
      else base.research++;
      if (f.tier !== "verified") continue; // headline stats are verified-tier only

      base.byClass[f.classId] = (base.byClass[f.classId] ?? 0) + 1;
      const asis = asiForClass(f.classId);
      for (const a of asis) base.byAsi[a] = (base.byAsi[a] ?? 0) + 1;

      // Classify by location: production code drives the headline, test/example code does not.
      const loc = f.locations[0];
      const isTest = TEST_PATH.test(loc?.path ?? "");
      if (isTest) {
        base.verifiedTest++;
      } else {
        base.verifiedProd++;
        base.byClassProd[f.classId] = (base.byClassProd[f.classId] ?? 0) + 1;
        for (const a of asis) base.byAsiProd[a] = (base.byAsiProd[a] ?? 0) + 1;
      }

      if (!base.samples.some((s) => s.classId === f.classId && s.isTest === isTest)) {
        base.samples.push({ classId: f.classId, asi: asis, path: loc?.path ?? "", line: loc?.startLine, isTest });
      }
    }
    return base;
  } catch (err) {
    return { ...base, error: (err as Error).message };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : 150;
  const concurrency = 4;

  console.log(`Discovering public MCP server repositories (target ${limit})…`);
  const repos = await discoverRepos(limit);
  console.log(`Discovered ${repos.length} repositories.`);

  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gatepass-mcp-survey-"));
  const results: RepoResult[] = [];
  let done = 0;

  async function worker(queue: RepoRef[]) {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const r = await scanRepo(next, workRoot);
      results.push(r);
      done++;
      const status = r.error ? `ERR ${r.error}` : `${r.verified}v/${r.research}r`;
      console.log(`[${done}/${repos.length}] ${next.fullName} — ${status}`);
    }
  }

  const queue = [...repos];
  await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));

  // ── Aggregate ────────────────────────────────────────────────────────
  // Denominator = repos confirmed to be MCP servers and successfully scanned. Repos that
  // turned out not to be MCP servers are reported separately, never silently in the base.
  const notMcp = results.filter((r) => r.error === "not-an-mcp-server").length;
  const failed = results.filter((r) => r.error && r.error !== "not-an-mcp-server").length;
  const scanned = results.filter((r) => !r.error);
  const withFindings = scanned.filter((r) => r.verified > 0);
  const byClass: Record<string, { repos: number; findings: number }> = {};
  const byAsi: Record<string, { repos: number; findings: number }> = {};
  const byClassProd: Record<string, { repos: number; findings: number }> = {};
  const byAsiProd: Record<string, { repos: number; findings: number }> = {};

  for (const r of scanned) {
    for (const [cls, n] of Object.entries(r.byClass)) {
      byClass[cls] = byClass[cls] ?? { repos: 0, findings: 0 };
      byClass[cls].repos++;
      byClass[cls].findings += n;
    }
    for (const [asi, n] of Object.entries(r.byAsi)) {
      byAsi[asi] = byAsi[asi] ?? { repos: 0, findings: 0 };
      byAsi[asi].repos++;
      byAsi[asi].findings += n;
    }
    for (const [cls, n] of Object.entries(r.byClassProd)) {
      byClassProd[cls] = byClassProd[cls] ?? { repos: 0, findings: 0 };
      byClassProd[cls].repos++;
      byClassProd[cls].findings += n;
    }
    for (const [asi, n] of Object.entries(r.byAsiProd)) {
      byAsiProd[asi] = byAsiProd[asi] ?? { repos: 0, findings: 0 };
      byAsiProd[asi].repos++;
      byAsiProd[asi].findings += n;
    }
  }
  const reposWithProdFinding = scanned.filter((r) => r.verifiedProd > 0).length;

  const aggregate = {
    generatedAt: new Date().toISOString(),
    method: {
      discovery: "GitHub search API — MCP server topics/names/SDK dependency",
      engine: "Gatepass deterministic engine (no LLM; semanticEnabled=false)",
      counted: "verified-tier findings only (machine-checked reproduction)",
      excluded: "node_modules, dist, build, .next, vendor, third_party, site-packages",
      testClassification:
        "Findings in test/spec/example/docs/fixture paths are counted separately and excluded from headline (production) figures.",
      rulesetVersion: "corpus-v1",
    },
    reposDiscovered: repos.length,
    reposConfirmedMcpAndScanned: scanned.length,
    reposScanned: scanned.length,
    reposExcludedNotMcpServer: notMcp,
    reposFailed: failed,
    reposWithAtLeastOneVerifiedFinding: withFindings.length,
    percentAffected: scanned.length ? +((withFindings.length / scanned.length) * 100).toFixed(1) : 0,
    // Production-only figures — the basis for every headline claim.
    reposWithProductionFinding: reposWithProdFinding,
    percentAffectedProduction: scanned.length ? +((reposWithProdFinding / scanned.length) * 100).toFixed(1) : 0,
    totalVerifiedFindingsProduction: scanned.reduce((n, r) => n + r.verifiedProd, 0),
    totalVerifiedFindingsInTestPaths: scanned.reduce((n, r) => n + r.verifiedTest, 0),
    totalVerifiedFindings: scanned.reduce((n, r) => n + r.verified, 0),
    totalFilesScanned: scanned.reduce((n, r) => n + r.filesScanned, 0),
    byAsiProduction: Object.fromEntries(
      ASI_CATEGORIES.map((c) => [
        c.id,
        { title: c.title, repos: byAsiProd[c.id]?.repos ?? 0, findings: byAsiProd[c.id]?.findings ?? 0 },
      ]),
    ),
    byClassProduction: byClassProd,
    byAsi: Object.fromEntries(
      ASI_CATEGORIES.map((c) => [
        c.id,
        {
          title: c.title,
          coverage: c.coverage,
          repos: byAsi[c.id]?.repos ?? 0,
          findings: byAsi[c.id]?.findings ?? 0,
        },
      ]),
    ),
    byClass,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "mcp-survey-aggregate.json"), JSON.stringify(aggregate, null, 2));
  await fs.writeFile(path.join(OUT_DIR, "mcp-survey-raw.json"), JSON.stringify(results, null, 2));
  await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});

  console.log("\n─────────── STATE OF MCP SECURITY ───────────");
  console.log(`Scanned:            ${aggregate.reposScanned} repos (${aggregate.totalFilesScanned} files)`);
  console.log(`With ≥1 verified:   ${aggregate.reposWithAtLeastOneVerifiedFinding} (${aggregate.percentAffected}%)`);
  console.log(`Total verified:     ${aggregate.totalVerifiedFindings}`);
  console.log("\nBy OWASP ASI category:");
  for (const c of ASI_CATEGORIES) {
    const v = aggregate.byAsi[c.id]!;
    if (v.findings > 0)
      console.log(
        `  ${c.id} ${c.title.padEnd(34)} ${String(v.repos).padStart(4)} repos  ${String(v.findings).padStart(5)} findings`,
      );
  }
  console.log("\nBy class:");
  for (const [cls, v] of Object.entries(byClass).sort((a, b) => b[1].repos - a[1].repos)) {
    console.log(`  ${cls.padEnd(32)} ${String(v.repos).padStart(4)} repos  ${String(v.findings).padStart(5)} findings`);
  }
  console.log(`\nWritten: ${OUT_DIR}`);
}

await main();
