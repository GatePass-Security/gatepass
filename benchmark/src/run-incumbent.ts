import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scoreTool, type CorpusCaseLabel, type Detection, type ToolBenchmark } from "./score.js";

/**
 * Reproducible incumbent benchmark run (FR-018, T080): scans the labeled corpus with a real
 * pinned incumbent (Semgrep) and scores it with the exact same `scoreTool` pipeline Gatepass
 * uses, so the published comparison is apples-to-apples by construction.
 *
 *   pnpm benchmark:incumbent
 *
 * Methodology notes (also in benchmark/INCUMBENT.md):
 * - The corpus is staged to a temp dir with an empty .semgrepignore and scanned with
 *   --no-git-ignore, because fixtures intentionally live in dirs scanners skip by default
 *   (dist/ bundles). The incumbent sees every file Gatepass sees.
 * - Incumbent rule ids are mapped onto Gatepass class ids GENEROUSLY (substring patterns per
 *   class): any rule that plausibly addresses the class counts as detecting it. Unmapped rule
 *   hits are still reported raw for transparency.
 */

interface CaseMeta {
  id: string;
  classId: string;
  label: "vulnerable" | "clean";
  dir: string;
}

/** Mirrors the corpus harness walk (corpus/harness/measure.ts): a case is a dir with case.json. */
export async function loadCases(casesRoot: string): Promise<CaseMeta[]> {
  const cases: CaseMeta[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      try {
        const meta = JSON.parse(await fs.readFile(path.join(full, "case.json"), "utf8"));
        cases.push({ id: meta.id, classId: meta.classId, label: meta.label, dir: full });
      } catch {
        await walk(full);
      }
    }
  }
  await walk(casesRoot);
  return cases;
}

/**
 * Generous rule-id → Gatepass-class mapping: if the incumbent fires ANY rule whose id
 * plausibly targets the class, it gets credit for detecting that class. Classes without a
 * pattern have no generic-SAST equivalent; a rule only counts there if it names the class.
 */
const CLASS_RULE_PATTERNS: Record<string, RegExp> = {
  "exposed-secret": /secret|credential|api[-_.]?key|access[-_.]?key|private[-_.]?key|hardcoded|token/i,
  "cors-misconfig": /cors|access-control-allow/i,
  "unpinned-dependency": /unpinned|pin(ned)?[-_.]?(dependenc|version)|version[-_.]?pin/i,
  "missing-schema-validation": /schema[-_.]?valid|input[-_.]?valid/i,
  "unauth-mcp-transport": /unauth|missing[-_.]?auth|no[-_.]?auth/i,
  "rls-gap": /row[-_.]?level[-_.]?security|\brls\b/i,
  "tool-poisoning": /tool[-_.]?poison|prompt[-_.]?inject/i,
  "confused-deputy": /confused[-_.]?deputy/i,
  hbv: /hidden[-_.]?behavior/i,
  "over-permissioned-loop": /over[-_.]?permission/i,
  "cross-surface-scope-mismatch": /scope[-_.]?mismatch/i,
  "unbounded-tool-param": /unbounded/i,
};

export function mapRuleToClasses(ruleId: string): string[] {
  return Object.entries(CLASS_RULE_PATTERNS)
    .filter(([, pattern]) => pattern.test(ruleId))
    .map(([classId]) => classId);
}

export interface SarifResultLite {
  ruleId: string;
  uri: string;
}

export function parseSarifResults(sarifText: string): SarifResultLite[] {
  try {
    const sarif = JSON.parse(sarifText) as {
      runs?: {
        results?: { ruleId?: string; locations?: { physicalLocation?: { artifactLocation?: { uri?: string } } }[] }[];
      }[];
    };
    const out: SarifResultLite[] = [];
    for (const run of sarif.runs ?? []) {
      for (const r of run.results ?? []) {
        const uri = r.locations?.[0]?.physicalLocation?.artifactLocation?.uri;
        if (r.ruleId && uri) out.push({ ruleId: r.ruleId, uri });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Normalize a SARIF uri or filesystem path for prefix comparison across platforms. */
function normalizePath(p: string): string {
  return decodeURIComponent(p.replace(/^file:\/+/i, ""))
    .replace(/\\/g, "/")
    .replace(/^\/(?=[a-zA-Z]:)/, "")
    .toLowerCase();
}

export interface CaseAttribution {
  /** Gatepass class ids the incumbent gets credit for, per case id. */
  classesByCase: Map<string, Set<string>>;
  /** Raw incumbent rule ids per case id (transparency: includes unmapped hits). */
  rulesByCase: Map<string, Set<string>>;
}

/** Attribute each SARIF result to the corpus case whose staged dir contains it. */
export function attributeToCases(
  results: readonly SarifResultLite[],
  stageRoot: string,
  caseIds: readonly string[],
): CaseAttribution {
  const stage = normalizePath(stageRoot);
  const classesByCase = new Map<string, Set<string>>();
  const rulesByCase = new Map<string, Set<string>>();
  for (const r of results) {
    const p = normalizePath(r.uri);
    const caseId = caseIds.find(
      (id) => p.startsWith(`${stage}/${id.toLowerCase()}/`) || p.includes(`/${id.toLowerCase()}/`),
    );
    if (!caseId) continue;
    if (!rulesByCase.has(caseId)) rulesByCase.set(caseId, new Set());
    rulesByCase.get(caseId)!.add(r.ruleId);
    if (!classesByCase.has(caseId)) classesByCase.set(caseId, new Set());
    for (const c of mapRuleToClasses(r.ruleId)) classesByCase.get(caseId)!.add(c);
  }
  return { classesByCase, rulesByCase };
}

/*
 * `stderr` is captured, not discarded. Every one of these tools reports its refusal to run there
 * and nowhere else — dropping it is what made a broken CodeQL invocation indistinguishable from a
 * CodeQL run that found nothing, for as long as it took someone to try the command by hand.
 */
function run(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: 600_000, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, PYTHONUTF8: "1" } },
      (err, stdout, stderr) =>
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: err && "code" in err ? Number(err.code) || 1 : 0,
        }),
    );
  });
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

const SEMGREP_CONFIGS = ["p/security-audit", "p/secrets", "p/default"];

/** A CLI incumbent that scans the staged corpus once and emits SARIF to {out}. */
interface IncumbentTool {
  id: string;
  bin: string;
  versionArgs: string[];
  /** Args template: {dir} = staged corpus root, {out} = SARIF output path. */
  args: (dir: string, out: string) => string[];
  install: string;
  label: (version: string) => string;
}

const TOOLS: IncumbentTool[] = [
  {
    id: "semgrep",
    bin: process.platform === "win32" ? "semgrep.exe" : "semgrep",
    versionArgs: ["--version"],
    args: (dir, out) => [
      "scan",
      ...SEMGREP_CONFIGS.flatMap((c) => ["--config", c]),
      "--sarif",
      "--output",
      out,
      "--metrics=off",
      "--no-git-ignore",
      "--quiet",
      dir,
    ],
    install: "pip install semgrep",
    label: (v) => `semgrep@${v} (${SEMGREP_CONFIGS.join(" + ")})`,
  },
  {
    id: "gitleaks",
    bin: "gitleaks",
    versionArgs: ["version"],
    args: (dir, out) => [
      "dir",
      dir,
      "--report-format",
      "sarif",
      "--report-path",
      out,
      "--exit-code",
      "0",
      "--no-banner",
    ],
    install: "winget install Gitleaks.Gitleaks",
    label: (v) => `gitleaks@${v}`,
  },
  {
    id: "trivy",
    bin: "trivy",
    versionArgs: ["--version"],
    args: (dir, out) => ["fs", "--scanners", "secret,misconfig", "--format", "sarif", "--output", out, dir],
    install: "winget install AquaSecurity.Trivy",
    label: (v) => `trivy@${v} (secret + misconfig)`,
  },
  {
    id: "codeql",
    bin: "gh",
    versionArgs: ["codeql", "version"],
    args: (dir, out) => ["codeql", "database", "analyze", dir, "--format=sarif-latest", `--output=${out}`],
    install: "gh extension install github/gh-codeql",
    label: (v) => `ghas-codeql@${v}`,
  },
  {
    id: "coderabbit",
    bin: "coderabbit",
    versionArgs: ["--version"],
    args: (dir, out) => ["review", "--format=sarif", `--output=${out}`, dir],
    install: "npm install -g coderabbit",
    label: (v) => `coderabbit-ai@${v}`,
  },
];

export interface IncumbentRun {
  benchmark: ToolBenchmark;
  rulesByCase: Map<string, Set<string>>;
}

/** Run one CLI incumbent against a pre-staged corpus copy and score it. */
async function runTool(
  tool: IncumbentTool,
  stage: string,
  cases: readonly { id: string; classId: string; label: "vulnerable" | "clean" }[],
  corpusVersion: string,
): Promise<IncumbentRun | { skipped: string }> {
  const versionOut = await run(tool.bin, tool.versionArgs, process.cwd());
  const version = versionOut.stdout.match(/\d+\.\d+\.\d+/)?.[0];
  if (versionOut.code !== 0 && !version) return { skipped: `${tool.id} not on PATH (${tool.install})` };

  const out = path.join(stage, `${tool.id}.sarif`);
  const analysis = await run(tool.bin, tool.args(stage, out), stage);
  /*
   * A tool that failed to run has not found nothing — it has found nothing *yet*, and the
   * difference is the whole value of this file.
   *
   * `fs.readFile(...).catch(() => "")` used to turn an absent report into an empty one, so a
   * broken invocation was scored as a clean sweep of misses. That is how `ghas-codeql@2.26.1`
   * came to be published at 0/90: the command was `codeql database analyze <source-dir>`, which
   * needs a database rather than a source tree, and it aborted with "is not a recognized CodeQL
   * database" on every case. We reported a competitor's product as detecting none of twelve
   * classes on the strength of a run that never read a line of code.
   *
   * So: a non-zero exit, or a missing report, is a *skip* with the reason attached. Skips are
   * printed and stored; they are never scored, and nothing downstream can mistake one for a zero.
   */
  const sarif = await fs.readFile(out, "utf8").catch(() => null);
  if (analysis.code !== 0 || sarif === null) {
    const detail = (analysis.stderr.trim() || analysis.stdout.trim() || `exit ${analysis.code}`)
      .split("\n")
      .find((l: string) => l.trim().length > 0)
      ?.slice(0, 240);
    await fs.rm(out, { force: true });
    return {
      skipped: `${tool.id} did not produce a report — NOT scored as zero. ${detail ?? "no output"}`,
    };
  }
  const results = parseSarifResults(sarif);
  await fs.rm(out, { force: true });

  const { classesByCase, rulesByCase } = attributeToCases(
    results,
    stage,
    cases.map((c) => c.id),
  );
  const labels: CorpusCaseLabel[] = cases.map(({ id, classId, label }) => ({ caseId: id, classId, label }));
  const detections: Detection[] = cases.map((c) => ({
    caseId: c.id,
    flaggedClassIds: [...(classesByCase.get(c.id) ?? [])],
  }));
  return { benchmark: scoreTool(tool.label(version ?? "unknown"), corpusVersion, labels, detections), rulesByCase };
}

export async function runIncumbentSuite(
  casesRoot: string,
  /* The corpus these tools actually just ran against — `loadCases` walks the live tree, so a
     stale default here labels a current measurement with a superseded version and invites it to
     be compared against numbers from a different population. */
  corpusVersion = "corpus-v2",
): Promise<{
  runs: IncumbentRun[];
  skipped: string[];
}> {
  const cases = await loadCases(casesRoot);
  if (cases.length === 0) throw new Error(`no corpus cases found under ${casesRoot}`);

  // Stage the corpus so default ignore rules (dist/, .gitignore) cannot hide fixtures.
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "gatepass-incumbent-"));
  const runs: IncumbentRun[] = [];
  const skipped: string[] = [];
  try {
    await copyDir(casesRoot, stage);
    await fs.writeFile(path.join(stage, ".semgrepignore"), "");
    for (const tool of TOOLS) {
      const result = await runTool(tool, stage, cases, corpusVersion);
      if ("skipped" in result) skipped.push(result.skipped);
      else runs.push(result);
    }
    return { runs, skipped };
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const casesRoot = path.resolve(HERE, "..", "..", "corpus", "cases");
  const { runs, skipped } = await runIncumbentSuite(casesRoot);

  for (const { benchmark, rulesByCase } of runs) {
    console.log(`\n=== ${benchmark.tool} (corpus ${benchmark.corpusVersion}) ===`);
    const detected = benchmark.perClass.filter((s) => s.truePositives > 0).length;
    console.log(
      `Classes detected: ${detected}/${benchmark.perClass.length}   overall FP rate: ${(benchmark.overallFpRate * 100).toFixed(1)}%`,
    );
    for (const s of benchmark.perClass.filter((c) => c.truePositives > 0 || c.falsePositives > 0)) {
      console.log(
        `  ${s.classId.padEnd(30)} TP ${s.truePositives}  FP ${s.falsePositives}  (${(s.tpRate * 100).toFixed(0)}% TP)`,
      );
    }
    if (rulesByCase.size > 0) {
      console.log("  raw rule hits:");
      for (const [caseId, rules] of rulesByCase) console.log(`    ${caseId}: ${[...rules].join(", ")}`);
    }
  }
  for (const s of skipped) console.log(`\nSKIPPED: ${s}`);

  const reportsDir = path.resolve(HERE, "..", "reports");
  await fs.mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, "incumbents.json");
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        skipped,
        tools: runs.map(({ benchmark, rulesByCase }) => ({
          ...benchmark,
          rawRuleHits: Object.fromEntries([...rulesByCase].map(([k, v]) => [k, [...v]])),
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nReport written: ${reportPath}`);
}
