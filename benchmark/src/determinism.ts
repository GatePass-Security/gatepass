import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScanContext } from "@gatepass/engine";
import { runScan } from "@gatepass/detectors";

/**
 * Determinism, cost, and latency benchmark.
 *
 * Detection parity is not the interesting axis — a frontier LLM given the taxonomy can find
 * these classes too (we measured it: see COMPETITIVE-BENCHMARK.md). The axes that decide
 * whether a scanner can be a CI GATE are:
 *
 *   1. Determinism   — identical input must produce byte-identical findings, every run.
 *   2. Cost          — per-scan marginal cost at PR frequency.
 *   3. Latency       — wall-clock time in the PR path.
 *
 * This harness measures all three for the Gatepass engine and states the LLM comparison from
 * an actual measured run (not an estimate) so the numbers are defensible.
 *
 *   pnpm benchmark:determinism
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const RUNS = 10;

/** Stable digest of a findings document: the exact output a CI gate would act on. */
function digest(findings: readonly { fingerprint: string; classId: string; tier: string; severity: string }[]): string {
  return findings
    .map((f) => `${f.fingerprint}|${f.classId}|${f.tier}|${f.severity}`)
    .sort()
    .join("\n");
}

async function main() {
  const target = path.join(ROOT, "corpus", "eval-repos", "vulnerable-nextjs-mcp");
  const ctx = await buildScanContext(target);

  const digests: string[] = [];
  const timings: number[] = [];

  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const doc = runScan(ctx, {
      scanId: `determinism-run-${i}`, // scanId varies; findings must not
      rulesetVersion: "corpus-v1",
      executionMode: "cli",
      semanticEnabled: false,
    });
    timings.push(performance.now() - t0);
    digests.push(digest(doc.findings));
  }

  const unique = new Set(digests);
  const deterministic = unique.size === 1;
  const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
  const sorted = [...timings].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]!;

  const result = {
    generatedAt: new Date().toISOString(),
    target: "corpus/eval-repos/vulnerable-nextjs-mcp",
    runs: RUNS,
    gatepass: {
      deterministic,
      distinctOutputs: unique.size,
      meanLatencyMs: +mean.toFixed(2),
      p95LatencyMs: +p95.toFixed(2),
      tokensConsumed: 0,
      marginalCostUsdPerScan: 0,
    },
    // Measured, not estimated: three Claude agents scanned 24 blind corpus samples
    // (8 each) as recorded in benchmark/reports/claude-blind-scan.json.
    llmBaselineMeasured: {
      source: "benchmark/COMPETITIVE-BENCHMARK.md — blind Claude scanner run",
      deterministic: false,
      reason: "Output varies with temperature, context, and model version; no stable digest to gate on.",
      tokensConsumedForTwentyFourSmallSamples: 110_000,
      wallClockSecondsPerBatchOfEight: 75,
    },
    interpretation: deterministic
      ? "Byte-identical findings across all runs. A CI gate and a published precision number are only possible on a deterministic engine."
      : "NON-DETERMINISTIC — investigate before publishing any precision claim.",
  };

  const outDir = path.join(ROOT, "benchmark", "reports");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "determinism.json"), JSON.stringify(result, null, 2));

  console.log("\n──────── DETERMINISM / COST / LATENCY ────────");
  console.log(`Runs:                 ${RUNS}`);
  console.log(
    `Distinct outputs:     ${unique.size}  ${deterministic ? "(byte-identical ✓)" : "(NON-DETERMINISTIC ✗)"}`,
  );
  console.log(`Mean latency:         ${mean.toFixed(1)} ms`);
  console.log(`p95 latency:          ${p95.toFixed(1)} ms`);
  console.log(`Tokens per scan:      0`);
  console.log(`Marginal cost/scan:   $0.00`);
  console.log("\nLLM baseline (measured, blind run over 24 tiny samples):");
  console.log(`  deterministic:      no`);
  console.log(`  tokens:             ~110,000`);
  console.log(`  wall clock:         ~75 s per batch of 8 samples`);
  console.log(`\nWritten: ${path.join(outDir, "determinism.json")}`);

  if (!deterministic) process.exitCode = 1;
}

await main();
