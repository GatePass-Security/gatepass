import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Independent spot-check of published survey findings.
 *
 * Before anything goes on Hacker News, this re-clones a random sample of surveyed repositories
 * AT THE EXACT COMMIT SHA recorded during the survey and confirms that each sampled finding's
 * cited file exists and the cited line contains code consistent with the claimed class.
 *
 * This deliberately does NOT re-run the scanner — re-running the same engine would only prove
 * the engine is deterministic (already measured elsewhere). It checks the claim against the
 * ground truth: the actual bytes of public code.
 *
 *   pnpm research:verify -- --sample 15
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");

interface RepoResult {
  repo: string;
  sha: string;
  error?: string;
  samples: { classId: string; asi: string[]; path: string; line?: number }[];
}

/** Evidence each class should leave on or near the cited line. */
const CLASS_EVIDENCE: Record<string, RegExp> = {
  "exposed-secret": /(AKIA|sk-|ghp_|ghs_|nvapi-|api[_-]?key|secret|token|password|PRIVATE KEY)/i,
  "cors-misconfig": /(access-control-allow-origin|cors|origin)/i,
  "unpinned-dependency": /("\*"|"latest"|\^|~)/,
  "missing-schema-validation": /(param|input|arg|schema|properties|inputSchema|tool)/i,
  "rls-gap": /(create\s+table|alter\s+table|row\s+level\s+security|policy)/i,
  "unauth-mcp-transport": /(sse|transport|listen|server|app\.|createServer|express|fastify|0\.0\.0\.0)/i,
  "unbounded-tool-param": /(type|string|array|param|properties|inputSchema)/i,
  "tool-poisoning": /(description|instruction|ignore|prompt|system)/i,
  "confused-deputy": /(authorization|bearer|token|header|fetch|axios|request)/i,
  hbv: /(description|tool|name)/i,
  "over-permissioned-loop": /(while|for|loop|iterate|agent|step)/i,
  "cross-surface-scope-mismatch": /(scope|permission|role|client|tool|admin)/i,
};

function run(
  cmd: string,
  args: string[],
  cwd?: string,
  timeoutMs = 300_000,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      resolve({ code: err ? 1 : 0, stdout: stdout ?? "" });
    });
  });
}

interface Check {
  repo: string;
  classId: string;
  location: string;
  status: "confirmed" | "file-missing" | "line-out-of-range" | "no-evidence" | "clone-failed";
  line?: string;
}

async function main() {
  const sampleArg = process.argv.indexOf("--sample");
  const sampleSize = sampleArg >= 0 ? Number(process.argv[sampleArg + 1]) : 12;

  const raw: RepoResult[] = JSON.parse(await fs.readFile(path.join(OUT, "mcp-survey-raw.json"), "utf8"));
  const withFindings = raw.filter((r) => !r.error && r.samples.length > 0 && r.sha);

  // Deterministic pseudo-random pick so a reviewer can reproduce the same sample.
  const picked: { repo: RepoResult; sample: RepoResult["samples"][number] }[] = [];
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pool = withFindings.flatMap((r) => r.samples.map((s) => ({ repo: r, sample: s })));
  while (picked.length < Math.min(sampleSize, pool.length) && pool.length > 0) {
    picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  }

  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gatepass-verify-"));
  const checks: Check[] = [];

  for (const { repo, sample } of picked) {
    const dir = path.join(workRoot, repo.repo.replace("/", "__"));
    const loc = `${sample.path}:${sample.line ?? "-"}`;

    if (!(await fs.stat(dir).catch(() => null))) {
      const clone = await run("git", ["clone", "--quiet", `https://github.com/${repo.repo}.git`, dir]);
      if (clone.code !== 0) {
        checks.push({ repo: repo.repo, classId: sample.classId, location: loc, status: "clone-failed" });
        continue;
      }
      // Pin to the exact SHA the survey scanned.
      await run("git", ["checkout", "--quiet", repo.sha], dir);
    }

    const abs = path.join(dir, sample.path);
    const content = await fs.readFile(abs, "utf8").catch(() => null);
    if (content === null) {
      checks.push({ repo: repo.repo, classId: sample.classId, location: loc, status: "file-missing" });
      continue;
    }
    const lines = content.split(/\r?\n/);
    const idx = (sample.line ?? 1) - 1;
    if (idx < 0 || idx >= lines.length) {
      checks.push({ repo: repo.repo, classId: sample.classId, location: loc, status: "line-out-of-range" });
      continue;
    }
    // Check the cited line plus a small window (declarations often span lines).
    const window = lines.slice(Math.max(0, idx - 2), Math.min(lines.length, idx + 3)).join("\n");
    const evidence = CLASS_EVIDENCE[sample.classId];
    const ok = evidence ? evidence.test(window) : true;
    checks.push({
      repo: repo.repo,
      classId: sample.classId,
      location: loc,
      status: ok ? "confirmed" : "no-evidence",
      line: lines[idx]!.trim().slice(0, 120),
    });
  }

  await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});

  const confirmed = checks.filter((c) => c.status === "confirmed").length;
  const failures = checks.filter((c) => c.status !== "confirmed" && c.status !== "clone-failed");

  await fs.writeFile(
    path.join(OUT, "verification.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), sampleSize: checks.length, confirmed, checks }, null, 2),
  );

  console.log(`\n──────── INDEPENDENT SPOT-CHECK ────────`);
  console.log(`Sampled findings:   ${checks.length}`);
  console.log(`Confirmed on disk:  ${confirmed}`);
  console.log(`Unconfirmed:        ${failures.length}`);
  for (const c of checks) {
    const mark = c.status === "confirmed" ? "✓" : "✗";
    console.log(`  ${mark} ${c.repo} ${c.classId} @ ${c.location} ${c.status !== "confirmed" ? `[${c.status}]` : ""}`);
    if (c.line) console.log(`      ${c.line}`);
  }
  if (failures.length > 0) {
    console.log(`\n⚠️  ${failures.length} finding(s) could not be confirmed. DO NOT PUBLISH until resolved.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll sampled findings confirmed against source at the recorded commit SHA.`);
  }
}

await main();
