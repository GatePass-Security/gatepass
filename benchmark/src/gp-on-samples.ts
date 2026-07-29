import { promises as fs } from "node:fs";
import path from "node:path";
import { buildScanContext } from "@gatepass/engine";
import { runScan } from "@gatepass/detectors";

/** Score Gatepass on exactly the cases drawn for the LLM baseline, for a like-for-like number. */
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const key = JSON.parse(
  await fs.readFile(path.join(ROOT, "benchmark/reports/llm-baseline/ANSWER-KEY.json"), "utf8"),
) as { samples: Record<string, { caseId: string; classId: string; label: string }> };

let tp = 0, fn = 0, fp = 0, vuln = 0, clean = 0;
const missed: string[] = [], alarms: string[] = [];

for (const [sample, t] of Object.entries(key.samples)) {
  const dir = path.join(ROOT, "corpus/cases", t.caseId, "tree");
  const ctx = await buildScanContext(dir);
  const doc = runScan(ctx, { scanId: sample, rulesetVersion: "corpus-v2", executionMode: "cli", semanticEnabled: true });
  const hit = doc.findings.some((f) => f.classId === t.classId);
  if (t.label === "vulnerable") {
    vuln++;
    if (hit) tp++; else { fn++; missed.push(`${sample} (${t.classId})`); }
  } else {
    clean++;
    if (hit) { fp++; alarms.push(`${sample} (${t.classId})`); }
  }
}
const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "n/a");
console.log(`\nGATEPASS on the same 24 LLM samples`);
console.log(`  recall        ${tp}/${vuln}  ${pct(tp, vuln)}`);
console.log(`  false alarms  ${fp}/${clean}  ${pct(fp, clean)}`);
if (missed.length) console.log(`  missed: ${missed.join(", ")}`);
if (alarms.length) console.log(`  false alarms: ${alarms.join(", ")}`);
