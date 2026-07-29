/**
 * Scores the blind LLM baseline.
 *
 * Three separations keep this honest, because the previous baseline had none of them:
 *   1. The model under test never sees the class taxonomy (except in the `guided` condition,
 *      which exists precisely to measure what that knowledge is worth).
 *   2. The model reports findings in free text. A separate judge maps that text onto class ids
 *      WITHOUT seeing the answer key, so it cannot work backwards from the expected label.
 *   3. Only this file ever reads the answer key, and it does nothing but arithmetic.
 *
 * A run is scored on both halves of the problem. Recall alone is the metric that made the old
 * baseline look like a tie: a model that flags something on every sample scores 100% recall and
 * is useless as a gate. Precision on the clean fixtures is where that falls apart.
 *
 *   pnpm benchmark:llm-score
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const DIR = path.join(ROOT, "benchmark", "reports", "llm-baseline");

interface AnswerKey {
  samples: Record<string, { caseId: string; classId: string; label: "vulnerable" | "clean" }>;
}

/** What a judge produces: for each sample, the class ids it believes the model reported. */
type Mapped = Record<string, string[]>;

interface ConditionResult {
  condition: string;
  samples: number;
  vulnerable: number;
  clean: number;
  /** Vulnerable samples where the model named the right class. */
  detected: number;
  missed: string[];
  /** Clean samples where the model claimed the class the fixture is clean for. */
  falseAlarms: number;
  falseAlarmCases: string[];
  /** Findings that named a class the fixture does not have — noise, per sample. */
  spuriousClaims: number;
  recall: number;
  falseAlarmRate: number;
  /** Share of all claims that were correct. The number a reviewer cares about. */
  precision: number;
}

function score(condition: string, mapped: Mapped, key: AnswerKey): ConditionResult {
  const ids = Object.keys(key.samples).sort();
  let detected = 0;
  let vulnerable = 0;
  let clean = 0;
  let falseAlarms = 0;
  let spurious = 0;
  let correctClaims = 0;
  let totalClaims = 0;
  const missed: string[] = [];
  const falseAlarmCases: string[] = [];

  for (const id of ids) {
    const truth = key.samples[id]!;
    const claims = [...new Set(mapped[id] ?? [])];
    totalClaims += claims.length;

    const namedIt = claims.includes(truth.classId);

    if (truth.label === "vulnerable") {
      vulnerable++;
      if (namedIt) {
        detected++;
        correctClaims++;
      } else {
        missed.push(`${id} (${truth.classId})`);
      }
      // Anything else it named on this sample is unverified noise.
      spurious += claims.length - (namedIt ? 1 : 0);
    } else {
      clean++;
      if (namedIt) {
        falseAlarms++;
        falseAlarmCases.push(`${id} (claimed ${truth.classId})`);
      }
      spurious += claims.length;
    }
  }

  return {
    condition,
    samples: ids.length,
    vulnerable,
    clean,
    detected,
    missed,
    falseAlarms,
    falseAlarmCases,
    spuriousClaims: spurious,
    recall: vulnerable ? detected / vulnerable : 0,
    falseAlarmRate: clean ? falseAlarms / clean : 0,
    precision: totalClaims ? correctClaims / totalClaims : 0,
  };
}

async function main() {
  const key = JSON.parse(await fs.readFile(path.join(DIR, "ANSWER-KEY.json"), "utf8")) as AnswerKey;

  const entries = (await fs.readdir(DIR)).filter((f) => f.startsWith("mapped-") && f.endsWith(".json"));
  if (entries.length === 0) {
    console.error(`No mapped-<condition>.json files in ${DIR}. Run the judge first.`);
    process.exit(1);
  }

  const results: ConditionResult[] = [];
  for (const file of entries.sort()) {
    const condition = file.replace(/^mapped-|\.json$/g, "");
    const mapped = JSON.parse(await fs.readFile(path.join(DIR, file), "utf8")) as Mapped;
    results.push(score(condition, mapped, key));
  }

  await fs.writeFile(
    path.join(DIR, "SCORED.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
    "utf8",
  );

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  console.log(`\n──────── LLM BASELINE ────────`);
  console.log(
    `${"condition".padEnd(14)} ${"recall".padStart(8)} ${"false alarms".padStart(13)} ${"precision".padStart(10)} ${"noise".padStart(7)}`,
  );
  for (const r of results) {
    console.log(
      `${r.condition.padEnd(14)} ${`${r.detected}/${r.vulnerable}`.padStart(8)} ${`${r.falseAlarms}/${r.clean}`.padStart(13)} ${pct(r.precision).padStart(10)} ${String(r.spuriousClaims).padStart(7)}`,
    );
  }
  for (const r of results) {
    console.log(`\n[${r.condition}] recall ${pct(r.recall)} · false-alarm rate ${pct(r.falseAlarmRate)}`);
    if (r.missed.length) console.log(`  missed: ${r.missed.join(", ")}`);
    if (r.falseAlarmCases.length) console.log(`  false alarms: ${r.falseAlarmCases.join(", ")}`);
  }
  console.log(`\nWrote ${path.join(DIR, "SCORED.json")}`);
}

await main();
