import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScanContext } from "@gatepass/engine";
import { runScan } from "@gatepass/detectors";
import { anchorLines, applyFixEdit, type Finding, type FindingsDocument } from "@gatepass/findings";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES_ROOT = path.resolve(HERE, "..", "cases");

export interface CaseMeta {
  id: string;
  classId: string;
  label: "vulnerable" | "clean";
  public: boolean;
  note?: string;
  dir: string;
}

export interface ClassMetrics {
  classId: string;
  vulnerable: number;
  clean: number;
  truePositives: number;
  falseNegatives: number;
  falsePositives: number;
  tpRate: number;
  fpRate: number;
}

export interface ReproIssue {
  caseId: string;
  fingerprint: string;
  reason: string;
}

/** A suggested fix that is not actually applicable to the fixture it was generated from. */
export interface FixIssue {
  caseId: string;
  fingerprint: string;
  reason: string;
}

export interface MeasureResult {
  corpusVersion: string;
  perClass: ClassMetrics[];
  overallFpRate: number;
  reproIssues: ReproIssue[];
  fixIssues: FixIssue[];
  /** Findings that carried a `diff` fix, i.e. one a reviewer could apply in one click. */
  applicableFixes: number;
  /** Findings that carried prose guidance instead. */
  guidanceFixes: number;
  casesMeasured: number;
}

async function loadCases(): Promise<CaseMeta[]> {
  const cases: CaseMeta[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const metaPath = path.join(full, "case.json");
        try {
          const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
          cases.push({ ...meta, dir: full });
        } catch {
          await walk(full);
        }
      }
    }
  }
  await walk(CASES_ROOT);
  return cases;
}

/**
 * Verify a reproduction is confirmable (SC-002): the cited location must exist within the
 * fixture tree and the line must be within the file's bounds. A fabricated or stale
 * reproduction fails here.
 */
async function verifyReproduction(treeDir: string, finding: Finding): Promise<string | null> {
  if (finding.tier !== "verified") return null;
  const loc = finding.locations[0]!;
  const abs = path.join(treeDir, loc.path);
  let content: string;
  try {
    content = await fs.readFile(abs, "utf8");
  } catch {
    return `cited file ${loc.path} does not exist in fixture`;
  }
  const lineCount = content.split(/\r?\n/).length;
  if (loc.startLine < 1 || loc.startLine > lineCount) {
    return `cited line ${loc.startLine} out of bounds (file has ${lineCount} lines)`;
  }
  return null;
}

/**
 * Verify a suggested fix is genuinely applicable to the fixture it was generated from.
 *
 * This is the remediation counterpart of `verifyReproduction`, and it exists for the same
 * reason: a claim Gatepass makes about a customer's code has to be checkable against real
 * code, not merely well-formed. A `diff` fix is delivered as a GitHub ```suggestion``` that
 * a reviewer applies in one click, so an anchor that does not exist, or an "insertion" that
 * loses the lines it was anchored to, is a bug that would land in someone's repository.
 *
 * Guidance-kind fixes carry no edit and are not checkable here — their correctness is a
 * matter of wording, covered by unit tests.
 */
async function verifyFix(treeDir: string, finding: Finding): Promise<string | null> {
  const fix = finding.suggestedFix;
  if (!fix || fix.kind !== "diff" || !fix.edit) return null;

  const abs = path.join(treeDir, fix.edit.path);
  let content: string;
  try {
    content = await fs.readFile(abs, "utf8");
  } catch {
    return `fix targets ${fix.edit.path}, which does not exist in the fixture`;
  }

  const anchor = anchorLines(content, fix.edit);
  if (!anchor) {
    const lineCount = content.split(/\r?\n/).length;
    return `fix anchors at lines ${fix.edit.startLine}-${fix.edit.endLine}, out of bounds (file has ${lineCount} lines)`;
  }

  let applied: string;
  try {
    applied = applyFixEdit(content, fix.edit);
  } catch (err) {
    return `fix is not applicable: ${(err as Error).message}`;
  }

  // An insertion must be purely additive. If any anchor line went missing, the "fix" would
  // have deleted the developer's code.
  for (const line of anchor) {
    if (!applied.includes(line)) return `applying the fix removed the anchor line ${JSON.stringify(line)}`;
  }
  if (!applied.includes(fix.edit.insertedLines.trim().split("\n")[0]!.trim())) {
    return "applying the fix did not add the suggested lines";
  }
  return null;
}

export async function measure(corpusVersion = "corpus-v1"): Promise<MeasureResult> {
  const cases = await loadCases();
  const byClass = new Map<string, ClassMetrics>();
  const reproIssues: ReproIssue[] = [];
  const fixIssues: FixIssue[] = [];
  let applicableFixes = 0;
  let guidanceFixes = 0;

  const ensure = (classId: string): ClassMetrics => {
    let m = byClass.get(classId);
    if (!m) {
      m = {
        classId,
        vulnerable: 0,
        clean: 0,
        truePositives: 0,
        falseNegatives: 0,
        falsePositives: 0,
        tpRate: 0,
        fpRate: 0,
      };
      byClass.set(classId, m);
    }
    return m;
  };

  for (const c of cases) {
    const treeDir = path.join(c.dir, "tree");
    const ctx = await buildScanContext(treeDir);
    const doc: FindingsDocument = runScan(ctx, {
      scanId: `corpus:${c.id}`,
      rulesetVersion: corpusVersion,
      executionMode: "cli",
      semanticEnabled: true,
    });
    const classFindings = doc.findings.filter((f) => f.classId === c.classId);
    const m = ensure(c.classId);

    if (c.label === "vulnerable") {
      m.vulnerable++;
      if (classFindings.length > 0) m.truePositives++;
      else m.falseNegatives++;
    } else {
      m.clean++;
      if (classFindings.length > 0) m.falsePositives++;
    }

    for (const f of classFindings) {
      const issue = await verifyReproduction(treeDir, f);
      if (issue) reproIssues.push({ caseId: c.id, fingerprint: f.fingerprint, reason: issue });

      if (f.suggestedFix?.kind === "diff") applicableFixes++;
      else if (f.suggestedFix) guidanceFixes++;
      const fixIssue = await verifyFix(treeDir, f);
      if (fixIssue) fixIssues.push({ caseId: c.id, fingerprint: f.fingerprint, reason: fixIssue });
    }
  }

  let fpTotal = 0;
  let cleanTotal = 0;
  for (const m of byClass.values()) {
    m.tpRate = m.vulnerable ? m.truePositives / m.vulnerable : 1;
    m.fpRate = m.clean ? m.falsePositives / m.clean : 0;
    fpTotal += m.falsePositives;
    cleanTotal += m.clean;
  }

  return {
    corpusVersion,
    perClass: [...byClass.values()].sort((a, b) => a.classId.localeCompare(b.classId)),
    overallFpRate: cleanTotal ? fpTotal / cleanTotal : 0,
    reproIssues,
    fixIssues,
    applicableFixes,
    guidanceFixes,
    casesMeasured: cases.length,
  };
}
