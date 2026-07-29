/**
 * Runs Semgrep against the corpus through Docker, and scores it with the same pipeline as
 * every other tool.
 *
 * Semgrep's Python package imports `resource`, a Unix-only module, so `pip install semgrep`
 * produces a package that cannot execute on native Windows. Every previous benchmark run on this
 * machine therefore recorded `SKIPPED: semgrep not on PATH` — the most important incumbent in the
 * comparison was simply absent, while the published table cited a number for it. Docker is
 * Semgrep's supported path on Windows, so this uses that.
 *
 *   pnpm benchmark:semgrep
 *
 * Same staging discipline as `run-incumbent.ts`: the corpus is copied to a temp dir with an empty
 * `.semgrepignore` and scanned with `--no-git-ignore`, because fixtures deliberately live in
 * directories scanners skip by default (`dist/` bundles, committed `.env` files). The incumbent
 * sees exactly the files Gatepass sees, which is the only way the comparison means anything.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCases, mapRuleToClasses, parseSarifResults, type SarifResultLite } from "./run-incumbent.js";
import { scoreTool, type CorpusCaseLabel, type Detection } from "./score.js";

/**
 * Attribute SARIF results to cases, for container-relative paths.
 *
 * The shared `attributeToCases` in run-incumbent.ts matches against the host staging directory,
 * because the tools it drives run on the host and emit absolute paths. Semgrep runs inside the
 * container with `/src` as its working directory, so it emits paths like
 * `verified/exposed-secret/vuln-aws-in-bundle/tree/dist/bundle.js` — no leading slash and no host
 * prefix, which matched neither branch of the shared matcher. The first run of this script
 * therefore reported 42 raw findings and 0 attributed, i.e. a fake zero for the most important
 * incumbent in the comparison. Anchoring at the start of the path is what that shape needs.
 */
function attributeContainerPaths(
  results: readonly SarifResultLite[],
  caseIds: readonly string[],
): { classesByCase: Map<string, Set<string>>; rulesByCase: Map<string, Set<string>>; unattributed: string[] } {
  const classesByCase = new Map<string, Set<string>>();
  const rulesByCase = new Map<string, Set<string>>();
  const unattributed: string[] = [];
  const lowered = caseIds.map((id) => [id, id.toLowerCase()] as const);

  for (const r of results) {
    const p = decodeURIComponent(r.uri.replace(/^file:\/+/i, ""))
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "")
      .toLowerCase();
    const hit = lowered.find(([, lower]) => p.startsWith(`${lower}/`) || p.includes(`/${lower}/`));
    if (!hit) {
      unattributed.push(r.uri);
      continue;
    }
    const [caseId] = hit;
    if (!rulesByCase.has(caseId)) rulesByCase.set(caseId, new Set());
    rulesByCase.get(caseId)!.add(r.ruleId);
    if (!classesByCase.has(caseId)) classesByCase.set(caseId, new Set());
    for (const c of mapRuleToClasses(r.ruleId)) classesByCase.get(caseId)!.add(c);
  }
  return { classesByCase, rulesByCase, unattributed };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CASES_ROOT = path.join(ROOT, "corpus", "cases");
const OUT = path.join(ROOT, "benchmark", "reports", "semgrep.json");

const IMAGE = "semgrep/semgrep:latest";
/** The same three rule packs the published comparison cites. */
const CONFIGS = ["p/security-audit", "p/secrets", "p/default"];

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 1_800_000, maxBuffer: 512 * 1024 * 1024 }, (err, stdout, stderr) =>
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
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function main() {
  const cases = await loadCases(CASES_ROOT);
  if (cases.length === 0) {
    console.error("No corpus cases found.");
    process.exit(1);
  }

  const version = (await run("docker", ["run", "--rm", IMAGE, "semgrep", "--version"])).stdout.trim().split("\n").pop();

  // Stage each case's tree under its case id so SARIF paths attribute back cleanly.
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "gatepass-semgrep-"));
  for (const c of cases) {
    await copyDir(path.join(c.dir, "tree"), path.join(stage, c.id));
  }
  await fs.writeFile(path.join(stage, ".semgrepignore"), "", "utf8");

  console.log(`semgrep ${version} · ${cases.length} cases · configs ${CONFIGS.join(" ")}`);
  console.log("Scanning (this takes a few minutes) …");

  const configArgs = CONFIGS.flatMap((c) => ["--config", c]);
  const started = Date.now();
  const res = await run("docker", [
    "run",
    "--rm",
    "-v",
    `${stage}:/src`,
    "-w",
    "/src",
    IMAGE,
    "semgrep",
    ...configArgs,
    "--sarif",
    "--no-git-ignore",
    "--metrics=off",
    "--quiet",
    ".",
  ]);
  const elapsedMs = Date.now() - started;

  const results = parseSarifResults(res.stdout);
  if (results.length === 0 && res.stdout.trim() === "") {
    console.error("Semgrep produced no output. stderr:");
    console.error(res.stderr.slice(0, 2000));
    process.exit(1);
  }

  const { classesByCase, rulesByCase, unattributed } = attributeContainerPaths(
    results,
    cases.map((c) => c.id),
  );
  if (unattributed.length > 0) {
    console.warn(`WARNING: ${unattributed.length} finding(s) could not be attributed to a case, e.g.:`);
    for (const u of unattributed.slice(0, 5)) console.warn(`  ${u}`);
  }

  const labels: CorpusCaseLabel[] = cases.map((c) => ({ caseId: c.id, classId: c.classId, label: c.label }));
  /* One entry per case carrying every class flagged for it — the shape `scoreTool` expects. An
     earlier version emitted one entry per (case, class) with a `classId` field, which type-checked
     against nothing and silently scored Semgrep at 0/12 while it was in fact detecting FastAPI
     wildcard CORS and AWS keys. A benchmark bug that flatters us is the worst kind. */
  const detections: Detection[] = cases.map((c) => ({
    caseId: c.id,
    flaggedClassIds: [...(classesByCase.get(c.id) ?? [])],
  }));

  const benchmark = scoreTool(`semgrep@${version} (${CONFIGS.join(" + ")})`, "corpus-v2", labels, detections);
  const detected = benchmark.perClass.filter((p) => p.truePositives > 0).length;
  const totalTp = benchmark.perClass.reduce((n, p) => n + p.truePositives, 0);
  const totalVuln = benchmark.perClass.reduce((n, p) => n + p.truePositives + p.falseNegatives, 0);
  const totalFp = benchmark.perClass.reduce((n, p) => n + p.falsePositives, 0);

  await fs.writeFile(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        via: "docker",
        image: IMAGE,
        version,
        configs: CONFIGS,
        elapsedMs,
        rawResultCount: results.length,
        benchmark,
        // Every rule that fired, including ones that map to no Gatepass class.
        rawRulesByCase: Object.fromEntries([...rulesByCase].map(([k, v]) => [k, [...v].sort()])),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\n──────── SEMGREP ${version} ────────`);
  console.log(`Raw findings      ${results.length}`);
  console.log(`Classes detected  ${detected}/12`);
  console.log(`Vulnerable cases  ${totalTp}/${totalVuln}`);
  console.log(`False positives   ${totalFp}`);
  console.log(`Wall clock        ${(elapsedMs / 1000).toFixed(1)}s for ${cases.length} cases`);
  for (const p of benchmark.perClass.filter((x) => x.truePositives > 0 || x.falsePositives > 0)) {
    console.log(`  ${p.classId.padEnd(30)} TP ${p.truePositives}  FP ${p.falsePositives}`);
  }
  console.log(`\nWrote ${OUT}`);

  await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
}

await main();
