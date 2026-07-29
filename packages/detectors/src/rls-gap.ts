import type { Detector, DetectorFinding, ScanContext } from "@gatepass/engine";
import { lineAtIndex } from "@gatepass/engine";

/**
 * Verified detector: a table is created without row-level security enabled and without a
 * per-tenant policy. Deterministically checkable from SQL / Supabase migration files. This
 * is the tenant-isolation gap that AI-generated schemas routinely miss.
 */

const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(\w+)["`]?/gi;

/**
 * Row-level security is a PostgreSQL feature. MySQL and SQLite have no such thing, so "this
 * table has no RLS policy" is not a gap there — it is a category error, and it asks a team to
 * add a statement their database will reject.
 *
 * Backtick-quoted identifiers and MySQL/SQLite-only clauses are the reliable tell. Observed on
 * sst/opencode, whose SQLite migrations produced dozens of findings that no reader could act on.
 */
const NON_POSTGRES_DIALECT =
  /`\w+`|\bAUTO_INCREMENT\b|\bENGINE\s*=\s*InnoDB\b|\bAUTOINCREMENT\b|\bPRAGMA\s+\w|\bunsigned\b|\bTINYINT\b|\bDATETIME\(\d\)/i;

function hasRlsFor(content: string, table: string): boolean {
  const enable = new RegExp(`alter\\s+table\\s+["\`]?${table}["\`]?\\s+enable\\s+row\\s+level\\s+security`, "i");
  const policy = new RegExp(`create\\s+policy[\\s\\S]{0,200}?on\\s+["\`]?${table}["\`]?`, "i");
  return enable.test(content) && policy.test(content);
}

export const rlsGapDetector: Detector = {
  classIds: ["rls-gap"],
  tier: "verified",
  run(ctx: ScanContext): DetectorFinding[] {
    const findings: DetectorFinding[] = [];
    for (const file of ctx.files) {
      if (!/\.sql$/i.test(file.relPath)) continue;
      if (NON_POSTGRES_DIALECT.test(file.content)) continue;
      CREATE_TABLE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CREATE_TABLE.exec(file.content)) !== null) {
        const table = m[1]!;
        if (hasRlsFor(file.content, table)) continue;
        const line = lineAtIndex(file.content, m.index);
        findings.push({
          tier: "verified",
          classId: "rls-gap",
          severity: "high",
          surfaces: file.surfaces,
          locations: [{ path: file.relPath, startLine: line, endLine: line, surface: file.surfaces[0]! }],
          explanation:
            `Table "${table}" is created in ${file.relPath}:${line} without row-level security ` +
            `enabled and a per-tenant policy. Any authenticated role can read every tenant's rows.`,
          reproduction: {
            kind: "inspection",
            steps: [
              `Open ${file.relPath} at line ${line} (create table "${table}").`,
              `Search the file for "alter table ${table} enable row level security" and a "create policy ... on ${table}" — neither is present.`,
            ],
            expected: `Table "${table}" has no RLS, so cross-tenant reads are possible.`,
          },
        });
      }
    }
    return findings;
  },
};
