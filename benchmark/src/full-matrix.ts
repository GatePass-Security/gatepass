/**
 * The full Gatepass measurement across the whole corpus.
 *
 * `corpus:measure` answers one question — did the right class fire on the right fixture. That is
 * the gate's question, but it is not the whole picture, and on its own it flatters us in one
 * specific way: a detector that fires the WRONG class on a clean fixture is invisible to it,
 * because it only counts findings whose classId matches the case. A tool that shouts something
 * on every clean file would still score a 0% false-positive rate.
 *
 * So this adds the axes a reviewer will actually ask about:
 *   - cross-class findings on clean fixtures — see the caveat below
 *   - latency: per-case wall clock, mean and p95
 *   - reproduction integrity: does every verified finding cite a line that really exists
 *
 * Caveat on the cross-class number, because it is easy to misread as a false-positive rate and
 * it is not one. A fixture labelled `clean` is clean FOR ITS OWN CLASS; it can still genuinely
 * exhibit another. The first one this measurement surfaced was a tool-poisoning clean fixture
 * whose `city` parameter is an unconstrained string — a real unbounded-tool-param, correctly
 * found. So these are reported for adjudication, never scored as errors. The precision figure
 * that belongs in a gate is the same-class rate.
 *
 *   pnpm benchmark:matrix
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScanContext } from "@gatepass/engine";
import { runScan } from "@gatepass/detectors";
import type { Finding } from "@gatepass/findings";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CASES_ROOT = path.join(ROOT, "corpus", "cases");
const OUT = path.join(ROOT, "benchmark", "reports", "full-matrix.json");

interface CaseMeta {
  id: string;
  classId: string;
  label: "vulnerable" | "clean";
  note?: string;
  dir: string;
}

async function loadCases(): Promise<CaseMeta[]> {
  const cases: CaseMeta[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      try {
        const meta = JSON.parse(await fs.readFile(path.join(full, "case.json"), "utf8"));
        cases.push({ ...meta, dir: full });
      } catch {
        await walk(full);
      }
    }
  }
  await walk(CASES_ROOT);
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

/** A verified finding must cite a line that exists — otherwise the evidence contract is broken. */
async function reproductionHolds(treeDir: string, finding: Finding): Promise<boolean> {
  if (finding.tier !== "verified") return true;
  const loc = finding.locations[0];
  if (!loc) return false;
  const content = await fs.readFile(path.join(treeDir, loc.path), "utf8").catch(() => null);
  if (content === null) return false;
  return loc.startLine >= 1 && loc.startLine <= content.split(/\r?\n/).length;
}

interface ClassRow {
  classId: string;
  vulnerable: number;
  clean: number;
  detected: number;
  missed: number;
  sameClassFp: number;
  anyClassFp: number;
  detectionRate: number;
  fpRate: number;
}

async function main() {
  let cases = await loadCases();
  if (cases.length === 0) {
    console.error("No corpus cases found.");
    process.exit(1);
  }

  /*
   * `--dev` and `--holdout` exist so detector work can be measured without ever touching the
   * held-out cases. Anyone tuning against a score they can see will, eventually, tune to it; the
   * holdout is only meaningful for as long as it stays unread during development.
   */
  const wantDev = process.argv.includes("--dev");
  const wantHoldout = process.argv.includes("--holdout");
  /* The clean-room subset: authored by agents that saw neither the detector source nor any
     existing fixture, and were not told which capabilities had just been built. It is the only
     population that answers "what happens on a codebase nobody involved has seen". */
  const wantCleanRoom = process.argv.includes("--cleanroom");
  let splitLabel = "full corpus";

  if (wantCleanRoom) {
    cases = cases.filter((c) => c.id.includes("/holdout3-"));
    splitLabel = "CLEAN-ROOM set";
    console.log(`Measuring ${cases.length} cases (${splitLabel}).`);
  } else if (wantDev || wantHoldout) {
    const split = JSON.parse(await fs.readFile(path.join(ROOT, "corpus", "SPLIT.json"), "utf8")) as {
      dev: string[];
      holdout: string[];
    };
    const keep = new Set(wantHoldout ? split.holdout : split.dev);
    cases = cases.filter((c) => keep.has(c.id));
    splitLabel = wantHoldout ? "HELD-OUT set" : "dev set";
    console.log(`Measuring ${cases.length} cases (${splitLabel}).`);
  } else {
    console.log(`Measuring ${cases.length} cases (${splitLabel}).`);
  }

  const rows = new Map<string, ClassRow>();
  const ensure = (classId: string): ClassRow => {
    let r = rows.get(classId);
    if (!r) {
      r = {
        classId,
        vulnerable: 0,
        clean: 0,
        detected: 0,
        missed: 0,
        sameClassFp: 0,
        anyClassFp: 0,
        detectionRate: 0,
        fpRate: 0,
      };
      rows.set(classId, r);
    }
    return r;
  };

  const latencies: number[] = [];
  const missedCases: string[] = [];
  const noisyCleanCases: { caseId: string; fired: string[] }[] = [];
  const malformed: string[] = [];
  let reproFailures = 0;
  let verifiedTotal = 0;

  for (const c of cases) {
    const treeDir = path.join(c.dir, "tree");
    /* A case with no tree is a corpus authoring error, not a scanner result. Report it and move
       on: one malformed fixture must not take down a measurement over a hundred others, and
       silently skipping it would quietly shrink the denominator. */
    const stat = await fs.stat(treeDir).catch(() => null);
    if (!stat?.isDirectory()) {
      malformed.push(c.id);
      continue;
    }
    const ctx = await buildScanContext(treeDir);

    const started = performance.now();
    const doc = runScan(ctx, {
      scanId: `matrix:${c.id}`,
      rulesetVersion: "corpus-v2",
      executionMode: "cli",
      semanticEnabled: true,
    });
    latencies.push(performance.now() - started);

    const row = ensure(c.classId);
    const sameClass = doc.findings.filter((f) => f.classId === c.classId);

    if (c.label === "vulnerable") {
      row.vulnerable++;
      if (sameClass.length > 0) row.detected++;
      else {
        row.missed++;
        missedCases.push(c.id);
      }
    } else {
      row.clean++;
      if (sameClass.length > 0) row.sameClassFp++;
      if (doc.findings.length > 0) {
        row.anyClassFp++;
        noisyCleanCases.push({ caseId: c.id, fired: [...new Set(doc.findings.map((f) => f.classId))] });
      }
    }

    for (const f of doc.findings) {
      if (f.tier !== "verified") continue;
      verifiedTotal++;
      if (!(await reproductionHolds(treeDir, f))) reproFailures++;
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;

  const perClass = [...rows.values()].sort((a, b) => a.classId.localeCompare(b.classId));
  for (const r of perClass) {
    r.detectionRate = r.vulnerable ? r.detected / r.vulnerable : 1;
    r.fpRate = r.clean ? r.sameClassFp / r.clean : 0;
  }

  const totals = {
    cases: cases.length - malformed.length,
    classes: perClass.length,
    vulnerable: perClass.reduce((n, r) => n + r.vulnerable, 0),
    clean: perClass.reduce((n, r) => n + r.clean, 0),
    detected: perClass.reduce((n, r) => n + r.detected, 0),
    missed: perClass.reduce((n, r) => n + r.missed, 0),
    sameClassFp: perClass.reduce((n, r) => n + r.sameClassFp, 0),
    anyClassFp: perClass.reduce((n, r) => n + r.anyClassFp, 0),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    corpusVersion: "corpus-v2",
    totals,
    detectionRate: totals.vulnerable ? totals.detected / totals.vulnerable : 0,
    sameClassFpRate: totals.clean ? totals.sameClassFp / totals.clean : 0,
    anyClassFpRate: totals.clean ? totals.anyClassFp / totals.clean : 0,
    latencyMs: { mean: Number(mean.toFixed(3)), p95: Number(p95.toFixed(3)) },
    reproduction: { verifiedFindings: verifiedTotal, failures: reproFailures },
    perClass,
    missedCases,
    noisyCleanCases,
    malformedCases: malformed,
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(report, null, 2), "utf8");

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  console.log(`\n──────── GATEPASS · FULL MATRIX ────────`);
  console.log(`Cases            ${totals.cases}  (${totals.vulnerable} vulnerable · ${totals.clean} clean)`);
  console.log(`Classes          ${totals.classes}`);
  console.log(`Detection        ${totals.detected}/${totals.vulnerable}  ${pct(report.detectionRate)}`);
  console.log(`Missed           ${totals.missed}`);
  console.log(`FP (same class)  ${totals.sameClassFp}/${totals.clean}  ${pct(report.sameClassFpRate)}   ← precision`);
  console.log(`Cross-class      ${totals.anyClassFp}/${totals.clean}  (adjudicate; not scored as errors)`);
  console.log(`Latency          ${report.latencyMs.mean} ms mean · ${report.latencyMs.p95} ms p95`);
  console.log(`Reproductions    ${verifiedTotal} verified · ${reproFailures} unconfirmable`);

  console.log(`\nPer class:`);
  console.log(`  ${"class".padEnd(30)} ${"detect".padStart(9)} ${"same-FP".padStart(9)} ${"any-FP".padStart(8)}`);
  for (const r of perClass) {
    console.log(
      `  ${r.classId.padEnd(30)} ${`${r.detected}/${r.vulnerable}`.padStart(9)} ${`${r.sameClassFp}/${r.clean}`.padStart(9)} ${`${r.anyClassFp}/${r.clean}`.padStart(8)}`,
    );
  }

  if (missedCases.length > 0) {
    console.log(`\nMissed (published, not hidden):`);
    for (const id of missedCases) console.log(`  ✗ ${id}`);
  }
  if (noisyCleanCases.length > 0) {
    console.log(`\nCross-class findings on clean fixtures (each needs a human verdict):`);
    for (const n of noisyCleanCases) console.log(`  ! ${n.caseId} → ${n.fired.join(", ")}`);
  }
  console.log(`\nWrote ${OUT}`);
}

await main();
