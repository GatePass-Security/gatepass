/**
 * Splits the corpus into a development set and a held-out set.
 *
 * This exists because of how the first corpus failed. Twelve classes each had exactly one
 * fixture, written next to the detector that catches it, and the result was a 100% score that
 * fell to 26.7% the moment somebody else wrote the fixtures. Tuning detectors against every case
 * you own reproduces that failure at a larger scale: the corpus stops being a measurement and
 * becomes a checklist.
 *
 * So a third of the cases are held out. Detector work may look at the dev set; the holdout is
 * only ever read by the scorer. A number measured on the holdout is a claim about whether the
 * detector generalises — which is the only claim worth publishing.
 *
 * The split is a deterministic hash of the case id, so it is stable across runs and machines and
 * nobody can quietly reshuffle it into a better score.
 *
 *   pnpm benchmark:split
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CASES_ROOT = path.join(ROOT, "corpus", "cases");
const OUT = path.join(ROOT, "corpus", "SPLIT.json");

/** Held-out share. A third leaves ~20 vulnerable and ~20 clean cases — enough to be meaningful. */
const HOLDOUT_SHARE = 1 / 3;

/**
 * Cases read by a detector agent during tuning. See corpus/INTEGRITY.md.
 *
 * They stay in the corpus — they are still perfectly good regression tests — but they can never
 * again serve as held-out evidence, so they are pinned to the dev side. Encoding this in the split
 * script rather than hand-editing SPLIT.json means the contamination survives a regeneration
 * instead of quietly washing out the next time somebody re-runs it.
 */
const RETIRED_FROM_HOLDOUT = new Set([
  "verified/cors-misconfig/clean-cors-regression-test",
  "verified/cors-misconfig/clean-fastify-public-readonly-wildcard",
  "verified/cors-misconfig/vuln-go-assembled-wildcard",
  "verified/cors-misconfig/vuln-nginx-reflected-origin",
  "verified/unbounded-tool-param/clean-bounded",
  "verified/unbounded-tool-param/clean-enum-constrained-action",
  "verified/unbounded-tool-param/vuln-freeform-command-string",
  "verified/unbounded-tool-param/vuln-unbounded-array-and-object",
]);

/**
 * Fixtures authored after the fact specifically to be evaluated against. Always held out.
 *
 * `holdout2-` replaced the two classes leaked during detector tuning. `holdout3-` is a full
 * clean-room set covering all twelve classes, written by agents that had seen neither the detector
 * source nor any existing fixture — and, deliberately, were not told which capabilities had just
 * been implemented. That last omission is what makes it a test rather than a rehearsal.
 */
const isReplacement = (id: string) => /\/holdout[23]-/.test(id);

/** FNV-1a. Small, stable, and not dependent on any runtime's hash iteration order. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

interface CaseMeta {
  id: string;
  classId: string;
  label: "vulnerable" | "clean";
}

async function loadCases(): Promise<CaseMeta[]> {
  const cases: CaseMeta[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      try {
        cases.push(JSON.parse(await fs.readFile(path.join(full, "case.json"), "utf8")));
      } catch {
        await walk(full);
      }
    }
  }
  await walk(CASES_ROOT);
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

async function main() {
  const cases = await loadCases();

  /* Stratified by (class, label) so the holdout cannot end up all-clean or missing a class,
     either of which would make the held-out score meaningless. */
  const strata = new Map<string, CaseMeta[]>();
  for (const c of cases) {
    const key = `${c.classId}:${c.label}`;
    const list = strata.get(key) ?? [];
    list.push(c);
    strata.set(key, list);
  }

  const holdout: string[] = [];
  const dev: string[] = [];
  for (const [, list] of [...strata.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Replacements are held out unconditionally; retired cases can never be held out again.
    const forced = list.filter((c) => isReplacement(c.id));
    const eligible = list.filter((c) => !isReplacement(c.id) && !RETIRED_FROM_HOLDOUT.has(c.id));
    const pinnedToDev = list.filter((c) => !isReplacement(c.id) && RETIRED_FROM_HOLDOUT.has(c.id));

    holdout.push(...forced.map((c) => c.id));
    dev.push(...pinnedToDev.map((c) => c.id));

    /* Only draw from `eligible` for the remainder of the quota the replacements have not already
       filled, so a class that gained replacements does not end up over-weighted in the holdout. */
    const quota = Math.max(0, Math.round(list.length * HOLDOUT_SHARE) - forced.length);
    const ranked = [...eligible].sort((a, b) => hash(a.id) - hash(b.id));
    ranked.forEach((c, i) => (i < quota ? holdout : dev).push(c.id));
  }

  holdout.sort();
  dev.sort();

  await fs.writeFile(
    OUT,
    JSON.stringify(
      {
        note: "Detector work may read `dev` cases. `holdout` is for scoring only — reading it while tuning invalidates the held-out number.",
        holdoutShare: HOLDOUT_SHARE,
        counts: { total: cases.length, dev: dev.length, holdout: holdout.length },
        retiredFromHoldout: [...RETIRED_FROM_HOLDOUT].sort(),
        retiredReason:
          "Read during detector tuning — see corpus/INTEGRITY.md. Kept for regression, never held out again.",
        holdout,
        dev,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Corpus split written to ${OUT}`);
  console.log(`  dev     ${dev.length}`);
  console.log(`  holdout ${holdout.length}`);
  const hv = cases.filter((c) => holdout.includes(c.id) && c.label === "vulnerable").length;
  console.log(`  holdout is ${hv} vulnerable / ${holdout.length - hv} clean across ${strata.size / 2} classes`);
}

await main();
