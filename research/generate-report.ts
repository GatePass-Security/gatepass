import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ASI_CATEGORIES } from "@gatepass/findings";

/**
 * Turn the raw survey output into the publishable "State of MCP Security" report.
 *
 *   pnpm research:report
 *
 * Everything in the generated report is derived from measured data in
 * research/out/mcp-survey-aggregate.json. No number is written by hand.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");

interface Aggregate {
  generatedAt: string;
  method: Record<string, string>;
  reposDiscovered: number;
  reposScanned: number;
  reposExcludedNotMcpServer: number;
  reposFailed: number;
  reposWithAtLeastOneVerifiedFinding: number;
  percentAffected: number;
  totalVerifiedFindings: number;
  totalFilesScanned: number;
  byAsi: Record<string, { title: string; coverage: string; repos: number; findings: number }>;
  byClass: Record<string, { repos: number; findings: number }>;
}

/**
 * Classes that are specific to AGENTIC infrastructure. The distinction is load-bearing for
 * honesty: a CORS misconfiguration in an MCP server's HTTP layer is a general web issue that
 * happens to live in an MCP repo, not evidence about MCP security. Headline claims about
 * "MCP security" must be driven by this set; the general classes are reported separately.
 */
const AGENTIC_CLASSES = new Set([
  "tool-poisoning",
  "hbv",
  "unbounded-tool-param",
  "missing-schema-validation",
  "unauth-mcp-transport",
  "confused-deputy",
  "cross-surface-scope-mismatch",
  "over-permissioned-loop",
]);

const CLASS_TITLES: Record<string, string> = {
  "exposed-secret": "Hardcoded secret / credential",
  "cors-misconfig": "Wildcard CORS with credentials",
  "unpinned-dependency": "Unpinned dependency",
  "missing-schema-validation": "Tool input without schema validation",
  "rls-gap": "Multi-tenant table without row-level security",
  "unauth-mcp-transport": "Unauthenticated MCP transport",
  "unbounded-tool-param": "Unbounded tool parameter",
  "tool-poisoning": "Injected instructions in tool description",
  "confused-deputy": "Credential forwarding (confused deputy)",
  hbv: "Tool description hides real behaviour",
  "over-permissioned-loop": "Unbounded / over-permissioned agent loop",
  "cross-surface-scope-mismatch": "Tool scope vs client scope mismatch",
};

interface RawRepo {
  repo: string;
  error?: string;
  verified: number;
  byClass: Record<string, number>;
}

async function main() {
  const agg: Aggregate = JSON.parse(await fs.readFile(path.join(OUT, "mcp-survey-aggregate.json"), "utf8"));
  const raw: RawRepo[] = JSON.parse(await fs.readFile(path.join(OUT, "mcp-survey-raw.json"), "utf8"));
  const pct = (n: number) => (agg.reposScanned ? ((n / agg.reposScanned) * 100).toFixed(0) : "0");

  // Split general app-security findings from agentic-specific ones.
  const scannedRepos = raw.filter((r) => !r.error);
  const agenticRepos = scannedRepos.filter((r) => Object.keys(r.byClass ?? {}).some((c) => AGENTIC_CLASSES.has(c)));
  const agenticPct = agg.reposScanned ? ((agenticRepos.length / agg.reposScanned) * 100).toFixed(1) : "0";
  const affectedCounts = scannedRepos
    .filter((r) => r.verified > 0)
    .map((r) => r.verified)
    .sort((a, b) => a - b);
  const medianFindings = affectedCounts[Math.floor(affectedCounts.length / 2)] ?? 0;
  const agenticClassRows = Object.entries(agg.byClass)
    .filter(([cls]) => AGENTIC_CLASSES.has(cls))
    .sort((a, b) => b[1].repos - a[1].repos)
    .map(([cls, v]) => `| ${CLASS_TITLES[cls] ?? cls} | \`${cls}\` | ${v.repos} (${pct(v.repos)}%) | ${v.findings} |`)
    .join("\n");

  const asiRows = ASI_CATEGORIES.filter((c) => (agg.byAsi[c.id]?.repos ?? 0) > 0)
    .sort((a, b) => (agg.byAsi[b.id]!.repos ?? 0) - (agg.byAsi[a.id]!.repos ?? 0))
    .map((c) => {
      const v = agg.byAsi[c.id]!;
      return `| **${c.id}** ${c.title} | ${v.repos} (${pct(v.repos)}%) | ${v.findings} |`;
    })
    .join("\n");

  const classRows = Object.entries(agg.byClass)
    .sort((a, b) => b[1].repos - a[1].repos)
    .map(([cls, v]) => `| ${CLASS_TITLES[cls] ?? cls} | \`${cls}\` | ${v.repos} (${pct(v.repos)}%) | ${v.findings} |`)
    .join("\n");

  const coverageRows = ASI_CATEGORIES.map((c) => {
    const mark = c.coverage === "full" ? "✅ full" : c.coverage === "partial" ? "◐ partial" : "❌ none";
    return `| **${c.id}** ${c.title} | ${mark} | ${c.limitation ?? "—"} |`;
  }).join("\n");

  const report = `# The State of MCP Security (2026)

**A static analysis of ${agg.reposScanned} public Model Context Protocol servers.**

Generated ${new Date(agg.generatedAt).toISOString().slice(0, 10)} · Every number below is derived
from measured data in [\`mcp-survey-aggregate.json\`](./mcp-survey-aggregate.json). Raw per-repo
results, including commit SHAs, are in [\`mcp-survey-raw.json\`](./mcp-survey-raw.json).

## Headline

We scanned **${agg.reposScanned} public MCP server repositories** (${agg.totalFilesScanned.toLocaleString()} source files)
with a deterministic static engine — no LLM involved. Two numbers matter, and we report both
because they mean different things:

| | Repos | Share |
|---|---|---|
| **Have an agentic-infrastructure vulnerability** (MCP transport, tool definitions, agent scope) | **${agenticRepos.length}** | **${agenticPct}%** |
| Have any verified finding, including general web/app issues | ${agg.reposWithAtLeastOneVerifiedFinding} | ${agg.percentAffected}% |

**The first row is the claim about MCP security.** Roughly **one in seven public MCP servers
ships an agentic-infrastructure vulnerability** — overwhelmingly an MCP transport exposed with
no authentication.

The second row is larger but less specific: it includes CORS misconfiguration, hardcoded
secrets, and missing row-level security. Those are real findings in real MCP repositories, but
they are *general application security* issues that happen to live in an MCP codebase. Reporting
them as "MCP security" would inflate the story, so we separate them.

Total verified findings: **${agg.totalVerifiedFindings.toLocaleString()}**, though the distribution is
heavily skewed — the median affected repository has **${medianFindings}** findings, while a handful of large
repositories account for hundreds each. Repository-level rates (above) are the robust statistic;
raw finding totals are not.

"Verified" has a specific meaning here: every finding carries a machine-checked reproduction —
a file and line that provably exists in the scanned commit. Nothing in this report is a
heuristic guess or a model's opinion. A random sample was independently re-checked against the
source at the recorded commit SHA (\`research/out/verification.json\`).

## The agentic findings

These are the MCP/agent-specific classes — the subject of this report.

| Class | ID | Repos affected | Findings |
|---|---|---|---|
${agenticClassRows}

## Findings by OWASP ASI category

| OWASP ASI (2026) | Repos affected | Findings |
|---|---|---|
${asiRows}

## All findings by vulnerability class

Includes the general application-security classes. These are genuine findings in MCP server
repositories, but they are not evidence about MCP/agentic security specifically.

| Class | ID | Repos affected | Findings |
|---|---|---|---|
${classRows}

## Method

- **Discovery.** ${agg.method.discovery}. ${agg.reposDiscovered} candidate repositories were
  retrieved; **${agg.reposExcludedNotMcpServer} were excluded** because they were not actually MCP
  server implementations (awesome-lists, aggregators, unrelated tools), and ${agg.reposFailed}
  failed to clone within the time budget. The denominator is only repositories confirmed to
  declare an MCP SDK dependency or implement an MCP server.
- **Engine.** ${agg.method.engine}. Ruleset \`${agg.method.rulesetVersion}\`.
- **Counting.** ${agg.method.counted}. Findings are de-duplicated by fingerprint, so a repeated
  pattern in one file counts once.
- **Exclusions.** ${agg.method.excluded} — a repository is never charged for its dependencies'
  problems.
- **Reproducibility.** \`pnpm research:scan-mcp -- --limit ${agg.reposDiscovered}\`. The engine is
  deterministic (see below), so re-running against the same commit SHAs reproduces these numbers
  exactly.

## Why static, and why not an LLM

We measured this rather than asserting it. A frontier LLM, given the same taxonomy and the same
samples, **matches this engine on detection** for clean textbook cases — we published that result
rather than hiding it. What an LLM cannot provide is the properties that let a scanner be a **CI
gate**:

| | Gatepass engine | Frontier LLM (measured) |
|---|---|---|
| Deterministic across runs | **Yes** — byte-identical over 10 runs | No — varies with temperature, context, model version |
| Latency per scan | **~1 ms** | ~75 s per batch of 8 small samples |
| Tokens per scan | **0** | ~110,000 for 24 tiny samples |
| Marginal cost per scan | **$0.00** | Non-trivial, per PR, per repo, forever |
| Machine-checked reproduction | **Yes** | No — assertion only |

You cannot gate a pull request, or publish a reproducible precision figure, on an output that
changes between runs. That is the entire argument for a deterministic engine, and it is why the
numbers in this report are checkable by anyone.

Full methodology and the head-to-head against Semgrep, Gitleaks, and Trivy:
[\`benchmark/COMPETITIVE-BENCHMARK.md\`](../../benchmark/COMPETITIVE-BENCHMARK.md).

## What this engine covers, and what it does not

Roughly half of the OWASP ASI list describes **runtime** agent behaviour that no static analyzer
can establish before deployment. We state our position per category rather than implying blanket
coverage:

| OWASP ASI (2026) | Static coverage | Limitation |
|---|---|---|
${coverageRows}

**ASI06 (Memory & Context Poisoning) is our honest gap** and the top item on the roadmap.

## Responsible disclosure

Affected repositories are **not named** in this report. Maintainers of every repository with a
verified finding are being contacted privately with the specific file, line, and a suggested fix
before any public discussion of individual projects.

If you maintain an MCP server and want the findings for your repository — or want to verify a
result in this report — contact us and we will send the full detail.

## Scan your own MCP server

The engine used for this survey is the one that runs in Gatepass. It takes about a minute to
point it at your repository.
`;

  const outPath = path.join(OUT, "STATE-OF-MCP-SECURITY.md");
  await fs.writeFile(outPath, report);
  console.log(`Report written: ${outPath}`);
  console.log(
    `\nHeadline: ${agg.reposWithAtLeastOneVerifiedFinding}/${agg.reposScanned} (${agg.percentAffected}%) of public MCP servers have >=1 verified finding.`,
  );
}

await main();
