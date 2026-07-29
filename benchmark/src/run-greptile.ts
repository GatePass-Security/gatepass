/**
 * Runs Greptile's CLI reviewer against the corpus and scores it with the shared pipeline.
 *
 * Greptile is a diff reviewer, not a tree scanner: `greptile review` compares the current branch
 * against its base. Handing it a directory the way Semgrep or Trivy is handed one would be an
 * unfair test — it would see no diff and report nothing, and we would publish a zero that says
 * more about the harness than the tool. So each case is staged as its own git repository with an
 * empty baseline commit, and the fixture arrives as a branch diff. That is the shape Greptile is
 * built for.
 *
 *   greptile login          # once — interactive, and only you can do it
 *   pnpm benchmark:greptile
 *
 * Requires authentication. This script will not attempt to log in, create an account, or handle
 * an API key; it checks `greptile whoami` and stops with instructions if you are not signed in.
 * Runs cost money against your Greptile account, so the case count is capped by default.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCases } from "./run-incumbent.js";
import { scoreTool, type CorpusCaseLabel, type Detection } from "./score.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CASES_ROOT = path.join(ROOT, "corpus", "cases");
const OUT = path.join(ROOT, "benchmark", "reports", "greptile.json");

function run(
  command: string,
  args: string[],
  cwd?: string,
  timeoutMs = 600_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" },
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
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

/**
 * Greptile returns prose review comments, not rule ids. Map a comment onto a Gatepass class by
 * looking for the vocabulary a reviewer would actually use for that class — generously, in the
 * same spirit as the rule-id mapping applied to the SAST tools.
 */
const CLASS_PHRASES: Record<string, RegExp> = {
  "exposed-secret": /\b(secret|credential|api[ -]?key|access[ -]?key|private key|hardcoded|token)\b/i,
  "cors-misconfig": /\b(cors|cross[- ]origin|allow[- ]origin|wildcard origin)\b/i,
  "unpinned-dependency": /\b(unpinned|not pinned|floating (version|tag)|mutable (tag|ref)|latest tag|version range)\b/i,
  "missing-schema-validation": /\b(validat\w+|unvalidated|schema|sanitis|sanitiz|input check)\b/i,
  "unauth-mcp-transport":
    /\b(unauthenticat\w+|no auth\w*|missing auth\w*|without authentication|publicly (exposed|accessible))\b/i,
  "rls-gap": /\b(row[- ]level security|\brls\b|tenant isolation|cross[- ]tenant|multi[- ]tenan\w+)\b/i,
  "tool-poisoning": /\b(prompt injection|tool poison\w*|injected instruction|malicious (instruction|description))\b/i,
  "confused-deputy": /\b(confused deputy|ssrf|forward\w* (the )?(credential|token)|server[- ]side request)\b/i,
  hbv: /\b(over[- ]broad|vague description|ambiguous scope|excessive capability)\b/i,
  "over-permissioned-loop": /\b(infinite loop|unbounded loop|no (iteration )?(limit|cap)|runaway|no step limit)\b/i,
  "cross-surface-scope-mismatch":
    /\b(scope mismatch|exceeds? (the )?(declared|granted) (scope|permission)|undeclared permission)\b/i,
  "unbounded-tool-param": /\b(unbounded|no (max|length|size) (limit|constraint)|unconstrained param\w*)\b/i,
};

function mapCommentToClasses(text: string): string[] {
  return Object.entries(CLASS_PHRASES)
    .filter(([, re]) => re.test(text))
    .map(([classId]) => classId);
}

interface GreptileComment {
  body?: string;
  comment?: string;
  message?: string;
  path?: string;
  file?: string;
}

/**
 * Thrown when the CLI did not return a review. It must never be confused with a review that
 * returned nothing.
 *
 * This distinction is the whole point. The first version of this file returned `[]` on any
 * unparseable stdout, so when `greptile review` refused to run at all — "this repository does not
 * have a Git remote configured", once per case, 24 times — the harness recorded twenty-four
 * empty reviews and scored the tool 0/12. A tool that was never invoked had been published as a
 * tool that found nothing. An incumbent's score is a claim about somebody else's product, and it
 * has to be wrong in their favour when the evidence is missing, not ours.
 */
class GreptileUnavailable extends Error {}

function commentsFrom(stdout: string, stderr: string, code: number): GreptileComment[] {
  if (code !== 0) {
    throw new GreptileUnavailable((stderr.trim() || stdout.trim() || `exit code ${code}`).split("\n")[0]);
  }
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (Array.isArray(parsed)) return parsed as GreptileComment[];
    const obj = parsed as { comments?: GreptileComment[]; findings?: GreptileComment[] };
    return obj.comments ?? obj.findings ?? [];
  } catch {
    // Exit 0 with output that is not the documented JSON is still not a review.
    throw new GreptileUnavailable(`could not parse \`greptile review --json\` output: ${stdout.slice(0, 200)}`);
  }
}

async function main() {
  const auth = await run("greptile", ["whoami"], undefined, 60_000);
  if (/not signed in/i.test(auth.stdout + auth.stderr)) {
    console.error("Greptile is not signed in.\n");
    console.error("  greptile login          # interactive browser sign-in");
    console.error("  greptile login --api-key\n");
    console.error("This script will not authenticate for you. Sign in, then re-run.");
    process.exit(1);
  }

  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : 24;
  const cleanRoomOnly = process.argv.includes("--cleanroom");
  /*
   * `--samples` runs exactly the 24 cases the LLM baseline was drawn on — one vulnerable and one
   * clean per class. Every review here costs a real API call against the operator's account, so
   * spending them on the population that already has two other tools measured on it buys a
   * three-way comparison, where an arbitrary slice of the corpus buys a fourth incomparable
   * column. Order follows the answer key, not the filesystem, so a `--limit` cut stays balanced.
   */
  const sampleSet = process.argv.includes("--samples");

  let cases = await loadCases(CASES_ROOT);
  if (sampleSet) {
    const key = JSON.parse(
      await fs.readFile(path.join(ROOT, "benchmark/reports/llm-baseline/ANSWER-KEY.json"), "utf8"),
    ) as { samples: Record<string, { caseId: string }> };
    const wanted = Object.values(key.samples).map((s) => s.caseId);
    const byId = new Map(cases.map((c) => [c.id, c]));
    const missing = wanted.filter((id) => !byId.has(id));
    if (missing.length) {
      console.error(`Answer key names ${missing.length} case(s) not present in the corpus:`);
      missing.forEach((m) => console.error(`  ${m}`));
      process.exit(1);
    }
    cases = wanted.map((id) => byId.get(id)!);
  } else if (cleanRoomOnly) {
    cases = cases.filter((c) => c.id.includes("/holdout3-"));
  }
  cases = cases.slice(0, limit);

  const population = sampleSet ? " (LLM sample set)" : cleanRoomOnly ? " (clean-room)" : "";
  console.log(`greptile · ${cases.length} cases${population}`);
  console.log(`Signed in as: ${auth.stdout.trim().split("\n")[0]}`);

  const classesByCase = new Map<string, Set<string>>();
  const rawByCase: Record<string, string[]> = {};
  const started = Date.now();

  for (const [i, c] of cases.entries()) {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "gatepass-greptile-"));
    try {
      // Baseline commit with nothing in it, so the fixture is the entire diff under review.
      await run("git", ["init", "-q", "-b", "main"], work);
      await run("git", ["config", "user.email", "bench@gatepass.local"], work);
      await run("git", ["config", "user.name", "gatepass-bench"], work);
      await fs.writeFile(path.join(work, "README.md"), "# baseline\n", "utf8");
      await run("git", ["add", "-A"], work);
      await run("git", ["commit", "-q", "-m", "baseline"], work);

      await run("git", ["checkout", "-q", "-b", "review"], work);
      await copyDir(path.join(c.dir, "tree"), work);
      await run("git", ["add", "-A"], work);
      await run("git", ["commit", "-q", "-m", "add service"], work);

      const res = await run("greptile", ["review", "--branch", "main", "--json"], work, 900_000);
      const comments = commentsFrom(res.stdout, res.stderr, res.code);
      const texts = comments.map((k) => k.body ?? k.comment ?? k.message ?? "").filter(Boolean);

      rawByCase[c.id] = texts;
      const found = new Set<string>();
      for (const t of texts) for (const cls of mapCommentToClasses(t)) found.add(cls);
      classesByCase.set(c.id, found);

      console.log(
        `  [${i + 1}/${cases.length}] ${c.id} → ${texts.length} comment(s), ${[...found].join(", ") || "no class"}`,
      );
    } catch (err) {
      if (!(err instanceof GreptileUnavailable)) throw err;
      /*
       * Abort the whole run, not this case. Every case is staged identically, so a refusal here
       * is a refusal for all of them — continuing would produce a full set of zeros that looks
       * exactly like a measurement and is not one. No report is written.
       */
      console.error(`\n  [${i + 1}/${cases.length}] ${c.id}`);
      console.error(`  greptile did not return a review: ${err.message}\n`);
      if (/remote/i.test(err.message)) {
        console.error("  `greptile review` reviews a branch of a repository it has indexed, which");
        console.error("  it identifies by the git remote. A corpus case staged as a local-only");
        console.error("  repository has no remote, so the CLI declines before reading any code.");
        console.error("  Benchmarking Greptile therefore needs the fixtures to live on a hosted");
        console.error("  repository it can index — a decision for whoever owns that account, not");
        console.error("  something this script should arrange.\n");
      }
      console.error("  No report written. Greptile is UNMEASURED, which is not the same as zero,");
      console.error("  and must never be published as a score.");
      process.exit(1);
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  const labels: CorpusCaseLabel[] = cases.map((c) => ({ caseId: c.id, classId: c.classId, label: c.label }));
  const detections: Detection[] = cases.map((c) => ({
    caseId: c.id,
    flaggedClassIds: [...(classesByCase.get(c.id) ?? [])],
  }));
  const benchmark = scoreTool("greptile-cli", "corpus-v2", labels, detections);

  const tp = benchmark.perClass.reduce((n, p) => n + p.truePositives, 0);
  const vuln = benchmark.perClass.reduce((n, p) => n + p.truePositives + p.falseNegatives, 0);
  const fp = benchmark.perClass.reduce((n, p) => n + p.falsePositives, 0);
  const classes = benchmark.perClass.filter((p) => p.truePositives > 0).length;

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        cases: cases.length,
        benchmark,
        rawByCase,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\n──────── GREPTILE ────────`);
  console.log(`Classes detected  ${classes}/12`);
  console.log(`Vulnerable cases  ${tp}/${vuln}`);
  console.log(`False positives   ${fp}`);
  console.log(`\nWrote ${OUT}`);
  // Unmapped prose is kept in the report so a reader can check the mapping was not too strict.
}

await main();
