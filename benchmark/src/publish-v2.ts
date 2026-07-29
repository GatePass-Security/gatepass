/*
 * Assemble the published benchmark artifacts the dashboard serves from `/v1/public/benchmark`.
 *
 * Two artifacts, because there are two honest populations and mixing them would be a lie of
 * arithmetic:
 *
 *   corpus-v2         the full corpus. Gatepass and Semgrep both run every case, so their
 *                     numbers are directly comparable. The LLM does not appear — it was never
 *                     run on this population, and an absent row is honest where an extrapolated
 *                     one is not.
 *
 *   corpus-v2-sample  the 24 drawn samples (one vulnerable + one clean per class) that the LLM
 *                     baseline was run on. Gatepass is re-scored here on exactly those 24 cases
 *                     rather than having its full-corpus number carried across, which is the
 *                     only way the head-to-head means anything.
 *
 * Scoring is one function for every tool. In particular a claim of class D on a case that is not
 * vulnerable-for-D counts as a false positive for D, whoever made it — so the LLM's spurious
 * claims are counted against it exactly as Gatepass's cross-class findings are counted against
 * Gatepass. The earlier sample harness only ever compared a case against its own class, which
 * silently forgave every off-target claim; that was generous to the baseline, not to us.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildScanContext } from "@gatepass/engine";
import { runScan } from "@gatepass/detectors";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const rel = (...p: string[]) => path.join(ROOT, ...p);

/** The shape `apps/web` renders and `POST /v1/benchmark/publish` accepts. */
interface PublishedClass {
  classId: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  recall: number;
  precision: number;
}
interface PublishedRun {
  tool: string;
  /** What this run was actually measured on. Two runs in one artifact always share it. */
  casesMeasured: number;
  perClass: PublishedClass[];
}

/** A tool's verdicts: case id → the set of class ids it asserted for that case. */
type Verdicts = Map<string, Set<string>>;
/** The truth: case id → {classId, vulnerable}. */
interface Truth {
  caseId: string;
  classId: string;
  vulnerable: boolean;
}

function score(truth: Truth[], verdicts: Verdicts): PublishedClass[] {
  const classes = [...new Set(truth.map((t) => t.classId))].sort();
  return classes.map((classId) => {
    let tp = 0;
    let fn = 0;
    let fp = 0;
    let tn = 0;
    for (const t of truth) {
      const claimed = verdicts.get(t.caseId)?.has(classId) ?? false;
      // "Vulnerable for this class" is the only thing that makes a claim of it correct. A case
      // that is vulnerable for some *other* class is still clean with respect to this one.
      const actuallyVuln = t.vulnerable && t.classId === classId;
      if (actuallyVuln) claimed ? tp++ : fn++;
      else claimed ? fp++ : tn++;
    }
    return {
      classId,
      tp,
      fp,
      fn,
      tn,
      recall: tp + fn > 0 ? tp / (tp + fn) : 0,
      precision: tp + fp > 0 ? tp / (tp + fp) : 0,
    };
  });
}

/** Run the real engine over a set of case trees and record every class it asserts. */
async function gatepassVerdicts(cases: { caseId: string; dir: string }[]): Promise<Verdicts> {
  const out: Verdicts = new Map();
  for (const c of cases) {
    const ctx = await buildScanContext(c.dir);
    const doc = runScan(ctx, {
      scanId: c.caseId,
      rulesetVersion: "corpus-v2",
      executionMode: "cli",
      semanticEnabled: true,
    });
    out.set(c.caseId, new Set(doc.findings.map((f) => f.classId)));
  }
  return out;
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

/* ── corpus-v2-sample: the 24-case head-to-head against the LLM ───────────────────────── */

async function buildSampleArtifact() {
  const key = await readJson<{
    samples: Record<string, { caseId: string; classId: string; label: string }>;
  }>(rel("benchmark/reports/llm-baseline/ANSWER-KEY.json"));

  const entries = Object.entries(key.samples);
  const truth: Truth[] = entries.map(([sample, t]) => ({
    caseId: sample,
    classId: t.classId,
    vulnerable: t.label === "vulnerable",
  }));

  const gp = await gatepassVerdicts(entries.map(([sample, t]) => ({ caseId: sample, dir: rel("corpus/cases", t.caseId, "tree") })));

  const runs: PublishedRun[] = [
    { tool: "Gatepass", casesMeasured: truth.length, perClass: score(truth, gp) },
  ];

  /*
   * Prompt conditions, weakest guidance first. "Guided" is the condition that was handed the
   * class list and told what to look for — it is kept because deleting an unflattering baseline
   * is exactly the thing this file exists to prevent, and it is labelled so no reader mistakes it
   * for what a user would actually type.
   */
  const conditions: [file: string, tool: string][] = [
    ["mapped-naive.json", "Claude (frontier LLM) — naive prompt"],
    ["mapped-practitioner.json", "Claude (frontier LLM) — practitioner prompt"],
    ["mapped-guided.json", "Claude (frontier LLM) — guided, given the class list"],
  ];

  for (const [file, tool] of conditions) {
    const mapped = await readJson<Record<string, string[]>>(rel("benchmark/reports/llm-baseline", file));
    const verdicts: Verdicts = new Map(Object.entries(mapped).map(([s, ids]) => [s, new Set(ids)]));
    runs.push({ tool, casesMeasured: truth.length, perClass: score(truth, verdicts) });
  }

  return {
    corpusVersion: "corpus-v2-sample",
    casesMeasured: truth.length,
    population:
      "24 cases drawn from the clean-room holdout — one vulnerable and one clean per class. Every tool saw exactly these cases.",
    runs,
  };
}

/* ── corpus-v2: the full corpus ───────────────────────────────────────────────────────── */

interface MatrixReport {
  totals: { cases: number };
  perClass: {
    classId: string;
    vulnerable: number;
    clean: number;
    detected: number;
    missed: number;
    sameClassFp: number;
    anyClassFp: number;
  }[];
}

async function buildFullArtifact() {
  const matrix = await readJson<MatrixReport>(rel("benchmark/reports/full-matrix.json"));

  const gatepass: PublishedRun = {
    tool: "Gatepass",
    casesMeasured: matrix.totals.cases,
    perClass: matrix.perClass.map((r) => ({
      classId: r.classId,
      tp: r.detected,
      fn: r.missed,
      // `anyClassFp`, not `sameClassFp`: a clean case that drew *any* finding is a false positive
      // to the person reading the report, whatever class the finding was filed under.
      fp: r.anyClassFp,
      tn: r.clean - r.anyClassFp,
      recall: r.vulnerable ? r.detected / r.vulnerable : 0,
      precision: r.detected + r.anyClassFp > 0 ? r.detected / (r.detected + r.anyClassFp) : 0,
    })),
  };

  const runs: PublishedRun[] = [gatepass];

  /** SARIF-style counts, as every incumbent harness records them. */
  interface IncumbentClass {
    classId: string;
    truePositives: number;
    falseNegatives: number;
    falsePositives: number;
    trueNegatives: number;
  }

  /**
   * Admit an incumbent only if it was scored on exactly this population.
   *
   * The version label alone is not enough: a corpus version is a moving target while cases are
   * being authored, and an incumbent report written a few hours earlier can carry the same label
   * over a smaller corpus. Published side by side, those columns invite a comparison they do not
   * support — and the incumbent is the one the discrepancy makes look worse. The fix is always to
   * re-run the incumbent, never to reconcile counts here.
   */
  function admit(tool: string, perClass: IncumbentClass[], corpusVersion: string): void {
    const cases = perClass.reduce(
      (n, r) => n + r.truePositives + r.falseNegatives + r.falsePositives + r.trueNegatives,
      0,
    );
    if (corpusVersion !== "corpus-v2" || cases !== matrix.totals.cases) {
      console.warn(
        `  ! ${tool}: scored on ${cases} cases of ${corpusVersion}; the matrix covers ` +
          `${matrix.totals.cases} of corpus-v2. Different populations — omitted.`,
      );
      return;
    }
    runs.push({
      tool,
      casesMeasured: cases,
      perClass: perClass.map((r) => ({
        classId: r.classId,
        tp: r.truePositives,
        fp: r.falsePositives,
        fn: r.falseNegatives,
        tn: r.trueNegatives,
        recall: r.truePositives + r.falseNegatives > 0 ? r.truePositives / (r.truePositives + r.falseNegatives) : 0,
        precision: r.truePositives + r.falsePositives > 0 ? r.truePositives / (r.truePositives + r.falsePositives) : 0,
      })),
    });
  }

  /*
   * Tools that did not produce a report are absent, not zero. `run-incumbent.ts` records them in
   * `skipped` with the reason; nothing here may turn one into a column. CodeQL sat at a published
   * 0/90 for exactly as long as that distinction was missing.
   */
  try {
    const inc = await readJson<{
      tools: { tool: string; corpusVersion: string; perClass: IncumbentClass[] }[];
      skipped?: string[];
    }>(rel("benchmark/reports/incumbents.json"));
    for (const t of inc.tools) admit(t.tool, t.perClass, t.corpusVersion);
    for (const s of inc.skipped ?? []) console.warn(`  · unmeasured, not published: ${s}`);
  } catch {
    console.warn("  ! No incumbents.json — publishing without gitleaks/trivy.");
  }

  /* Semgrep runs through its own Docker harness, so it reports separately from the PATH tools. */
  try {
    const sg = await readJson<{
      benchmark: { tool: string; corpusVersion: string; perClass: IncumbentClass[] };
    }>(rel("benchmark/reports/semgrep.json"));
    admit(sg.benchmark.tool, sg.benchmark.perClass, sg.benchmark.corpusVersion);
  } catch {
    console.warn("  ! No semgrep.json — publishing without Semgrep.");
  }

  return {
    corpusVersion: "corpus-v2",
    casesMeasured: matrix.totals.cases,
    population: "The full versioned corpus. Every tool listed ran every case.",
    runs,
  };
}

/* ── main ─────────────────────────────────────────────────────────────────────────────── */

const artifacts = [await buildFullArtifact(), await buildSampleArtifact()];

for (const artifact of artifacts) {
  const out = rel("benchmark/published", `${artifact.corpusVersion}.json`);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify({ ...artifact, publishedAt: new Date().toISOString() }, null, 2), "utf8");

  console.log(`\n${artifact.corpusVersion}  (${artifact.casesMeasured} cases)`);
  for (const run of artifact.runs) {
    const tp = run.perClass.reduce((n, r) => n + r.tp, 0);
    const fn = run.perClass.reduce((n, r) => n + r.fn, 0);
    const fp = run.perClass.reduce((n, r) => n + r.fp, 0);
    const detected = run.perClass.filter((r) => r.tp > 0).length;
    const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
    console.log(
      `  ${run.tool.padEnd(48)} ${detected}/${run.perClass.length} classes · ` +
        `recall ${tp}/${tp + fn} ${pct(tp, tp + fn)} · precision ${pct(tp, tp + fp)} · ${fp} FP`,
    );
  }
  console.log(`  → ${path.relative(ROOT, out)}`);
}
