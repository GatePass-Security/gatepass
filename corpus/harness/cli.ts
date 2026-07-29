import { measure } from "./measure.js";

/**
 * `pnpm corpus:measure --corpus corpus-v1`
 * Exit non-zero on any reproduction that cannot be confirmed (SC-002) or if a class has
 * zero fixtures (Constitution gate: no rule without fixtures). This is the CI gate body.
 */
async function main(): Promise<void> {
  const arg = process.argv.indexOf("--corpus");
  const version = arg >= 0 ? (process.argv[arg + 1] ?? "corpus-v1") : "corpus-v1";

  const result = await measure(version);

  console.log(`\nGatepass corpus measurement — ${result.corpusVersion}`);
  console.log(`Cases measured: ${result.casesMeasured}\n`);
  console.log("Class                      Vuln  Clean   TP   FN   FP   TP-rate  FP-rate");
  console.log("-".repeat(76));
  for (const m of result.perClass) {
    console.log(
      `${m.classId.padEnd(26)} ${String(m.vulnerable).padStart(4)} ${String(m.clean).padStart(6)} ` +
        `${String(m.truePositives).padStart(4)} ${String(m.falseNegatives).padStart(4)} ${String(m.falsePositives).padStart(4)} ` +
        `${(m.tpRate * 100).toFixed(1).padStart(7)}% ${(m.fpRate * 100).toFixed(1).padStart(6)}%`,
    );
  }
  console.log("-".repeat(76));
  console.log(`Overall FP rate: ${(result.overallFpRate * 100).toFixed(1)}%  (target ≤ 10% — SC-001)`);
  console.log(
    `Remediation: ${result.applicableFixes} applicable edit(s), ${result.guidanceFixes} guidance-only ` +
      `(FR-012 — a fix is only an "edit" when it can be applied as one)`,
  );

  let failed = false;

  if (result.reproIssues.length > 0) {
    console.error(`\n✗ ${result.reproIssues.length} non-confirmable reproduction(s) (SC-002):`);
    for (const i of result.reproIssues) console.error(`  - ${i.caseId} [${i.fingerprint}]: ${i.reason}`);
    failed = true;
  }

  // A suggested edit that does not apply cleanly to the fixture it came from would land in a
  // customer's branch as a broken hunk, so it fails the gate exactly like a bad reproduction.
  if (result.fixIssues.length > 0) {
    console.error(`\n✗ ${result.fixIssues.length} inapplicable suggested fix(es) (FR-012):`);
    for (const i of result.fixIssues) console.error(`  - ${i.caseId} [${i.fingerprint}]: ${i.reason}`);
    failed = true;
  }

  const noFixtures = result.perClass.filter((m) => m.vulnerable + m.clean === 0);
  if (noFixtures.length > 0) {
    console.error(`\n✗ classes with no fixtures: ${noFixtures.map((m) => m.classId).join(", ")}`);
    failed = true;
  }

  if (result.overallFpRate > 0.1) {
    console.error(`\n✗ overall FP rate ${(result.overallFpRate * 100).toFixed(1)}% exceeds 10% bar (SC-001)`);
    failed = true;
  }

  if (failed) {
    console.error("\nCorpus gate: FAIL");
    process.exit(1);
  }
  console.log("\nCorpus gate: PASS ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
