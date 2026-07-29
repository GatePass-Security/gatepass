/**
 * Builds the blind sample packets for the LLM baseline.
 *
 * The previous LLM baseline was not a fair test. It handed the model the twelve Gatepass class
 * IDs and asked it to pick from them — the answers were in the question, and the model duly
 * emitted exact slugs like `cross-surface-scope-mismatch`, which no model produces unprompted.
 * That measures multiple-choice recall, not detection, and it flattered the model.
 *
 * This harness fixes that. It emits anonymised packets containing only the fixture's source
 * files — no class name, no case id, no directory path, no hint that the corpus even has a
 * taxonomy — and keeps the answer key in a separate file the graders never see. The same packets
 * are then given to the model under three prompt conditions (naive / practitioner / guided) so
 * the effect of the prompt can be isolated rather than assumed.
 *
 *   pnpm benchmark:llm-samples -- --per-class 3
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CASES_ROOT = path.join(ROOT, "corpus", "cases");
const OUT = path.join(ROOT, "benchmark", "reports", "llm-baseline");

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
  return cases;
}

/** Every file in a fixture tree, relative to the tree root. */
async function readTree(treeDir: string): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        const rel = path.relative(treeDir, full).split(path.sep).join("/");
        files.push({ path: rel, content: await fs.readFile(full, "utf8") });
      }
    }
  }
  await walk(treeDir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Deterministic shuffle so a reviewer can reproduce the exact packet ordering. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function main() {
  const perClassArg = process.argv.indexOf("--per-class");
  const perClass = perClassArg >= 0 ? Number(process.argv[perClassArg + 1]) : 3;
  /* Draw from the clean-room set so the model is scored on exactly the cases Gatepass was scored
     on. Any other population would make the two numbers incomparable, and comparing them is the
     entire reason this harness exists. */
  const cleanRoomOnly = process.argv.includes("--cleanroom");

  const all = (await loadCases()).filter((c) => !cleanRoomOnly || c.id.includes("/holdout3-"));
  const byClass = new Map<string, CaseMeta[]>();
  for (const c of all) {
    const list = byClass.get(c.classId) ?? [];
    list.push(c);
    byClass.set(c.classId, list);
  }

  /* Stratified so every class is represented and the vulnerable:clean ratio stays honest — a
     sample of only vulnerable fixtures would make any tool that shouts "vulnerable" look perfect. */
  const picked: CaseMeta[] = [];
  for (const [, list] of [...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const vuln = seededShuffle(
      list.filter((c) => c.label === "vulnerable"),
      7,
    );
    const clean = seededShuffle(
      list.filter((c) => c.label === "clean"),
      13,
    );
    const wantVuln = Math.ceil(perClass / 2);
    picked.push(...vuln.slice(0, wantVuln), ...clean.slice(0, perClass - wantVuln));
  }

  const samples = seededShuffle(picked, 42);

  await fs.rm(OUT, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(path.join(OUT, "samples"), { recursive: true });

  const key: Record<string, { caseId: string; classId: string; label: string }> = {};

  for (const [i, c] of samples.entries()) {
    const name = `sample-${String(i + 1).padStart(2, "0")}`;
    const files = await readTree(path.join(c.dir, "tree"));
    const body = files
      .map((f) => `### \`${f.path}\`\n\n\`\`\`\n${f.content.replace(/\r\n/g, "\n").trimEnd()}\n\`\`\``)
      .join("\n\n");
    await fs.writeFile(
      path.join(OUT, "samples", `${name}.md`),
      `# ${name}\n\nA small codebase. ${files.length} file(s).\n\n${body}\n`,
      "utf8",
    );
    key[name] = { caseId: c.id, classId: c.classId, label: c.label };
  }

  await fs.writeFile(
    path.join(OUT, "ANSWER-KEY.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), perClass, samples: key }, null, 2),
    "utf8",
  );

  const vulnCount = samples.filter((s) => s.label === "vulnerable").length;
  console.log(`Wrote ${samples.length} blind samples to ${path.join(OUT, "samples")}`);
  console.log(`  ${vulnCount} vulnerable · ${samples.length - vulnCount} clean · ${byClass.size} classes`);
  console.log(`Answer key (graders must not see this): ${path.join(OUT, "ANSWER-KEY.json")}`);
}

await main();
