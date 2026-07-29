import { describe, it, expect } from "vitest";
import { parseFinding, type Finding } from "@gatepass/findings";
import { generateSuggestedFix, fixSourceFrom, FIXED_CLASS_IDS, DEFAULT_DETECTORS } from "../src/index.js";

function makeFinding(classId: string, overrides: Record<string, unknown> = {}): Finding {
  return {
    tier: "verified",
    fingerprint: `test-${classId}`,
    classId,
    severity: "high",
    surfaces: ["app_code"],
    locations: [{ path: "test.ts", startLine: 1, endLine: 10, surface: "app_code" }],
    explanation: "detector explanation",
    reproduction: { kind: "command", steps: ["repro step 1"], expected: "finding reproduced" },
    ...overrides,
  } as Finding;
}

const source = (path: string, content: string) => fixSourceFrom(new Map([[path, content]]));

describe("generateSuggestedFix — coverage", () => {
  it("covers every class the default ruleset can emit", () => {
    const emitted = [...new Set(DEFAULT_DETECTORS.flatMap((d) => d.classIds))].sort();
    expect(emitted.length).toBe(12);
    expect(FIXED_CLASS_IDS).toEqual(expect.arrayContaining(emitted));
  });

  it("returns something substantive for every emitted class, not a placeholder", () => {
    for (const classId of FIXED_CLASS_IDS) {
      const fix = generateSuggestedFix(makeFinding(classId));
      expect(fix, classId).toBeDefined();
      // A non-answer like "review manually" is what this file exists to prevent.
      expect(fix!.content.length, classId).toBeGreaterThan(120);
      expect(fix!.content.toLowerCase(), classId).not.toContain("no automated guidance");
    }
  });

  it("returns undefined only for a class it has never heard of", () => {
    expect(generateSuggestedFix(makeFinding("some-unknown-class"))).toBeUndefined();
  });
});

describe("generateSuggestedFix — the diff/guidance boundary", () => {
  /*
   * The invariant this whole module is built around: a `diff` is applied by a reviewer in
   * one click, so it must carry a real edit. Anything else must be guidance.
   */
  it("never produces a diff without an applicable edit", () => {
    for (const classId of FIXED_CLASS_IDS) {
      const fix = generateSuggestedFix(makeFinding(classId));
      if (fix?.kind === "diff") expect(fix.edit, classId).toBeDefined();
      if (fix?.kind === "agent_guidance") expect(fix.edit, classId).toBeUndefined();
    }
  });

  it("every generated fix passes the canonical schema", () => {
    for (const classId of FIXED_CLASS_IDS) {
      const fix = generateSuggestedFix(makeFinding(classId));
      expect(() => parseFinding({ ...makeFinding(classId), suggestedFix: fix })).not.toThrow();
    }
  });

  /*
   * Regression guard for the original bug: `cors-misconfig` shipped `kind: "diff"` whose
   * content was a comment plus `const allowed = ["https://app.example.com"]`. Committing
   * that would have deleted the developer's CORS line and left a stranger's domain behind.
   */
  it("does not invent a placeholder origin for cors-misconfig", () => {
    const fix = generateSuggestedFix(makeFinding("cors-misconfig"));
    expect(fix!.kind).toBe("agent_guidance");
    expect(fix!.content).not.toContain("app.example.com");
    expect(fix!.content).toMatch(/allow-list/i);
  });

  /* The finding points into package.json; a `//` comment there is invalid JSON. */
  it("does not emit a JavaScript comment as an edit for unpinned-dependency", () => {
    const fix = generateSuggestedFix(
      makeFinding("unpinned-dependency", {
        locations: [{ path: "package.json", startLine: 4, endLine: 4, surface: "app_code" }],
      }),
    );
    expect(fix!.kind).toBe("agent_guidance");
    expect(fix!.edit).toBeUndefined();
  });

  it("tells the developer to rotate an exposed secret rather than offering an edit", () => {
    const fix = generateSuggestedFix(makeFinding("exposed-secret"));
    expect(fix!.kind).toBe("agent_guidance");
    expect(fix!.content).toMatch(/rotate/i);
    expect(fix!.content).toMatch(/history/i);
  });
});

describe("generateSuggestedFix — rls-gap is derived from the SQL, not from prose", () => {
  const sql = [
    "create table if not exists invoices (", // 1
    "  id uuid primary key default gen_random_uuid(),", // 2
    "  tenant_id uuid not null,", // 3
    "  amount numeric", // 4
    ");", // 5
    "", // 6
  ].join("\n");

  const finding = makeFinding("rls-gap", {
    locations: [{ path: "db/schema.sql", startLine: 1, endLine: 1, surface: "app_code" }],
    explanation: "no table name in this sentence at all",
  });

  it("recovers the table name from the source even when the explanation never mentions it", () => {
    const fix = generateSuggestedFix(finding, source("db/schema.sql", sql));
    expect(fix!.kind).toBe("diff");
    expect(fix!.edit!.insertedLines).toContain("alter table invoices enable row level security;");
  });

  it("anchors the edit to the END of the multi-line statement, not its first line", () => {
    const fix = generateSuggestedFix(finding, source("db/schema.sql", sql));
    // Inserting after line 1 would land inside the column list and produce invalid SQL.
    expect(fix!.edit!.startLine).toBe(1);
    expect(fix!.edit!.endLine).toBe(5);
  });

  it("names a candidate scoping column it actually found in the DDL", () => {
    const fix = generateSuggestedFix(finding, source("db/schema.sql", sql));
    expect(fix!.edit!.insertedLines).toContain("tenant_id");
  });

  it("leaves the policy commented out — the predicate is not Gatepass's to choose", () => {
    const fix = generateSuggestedFix(finding, source("db/schema.sql", sql));
    const policyLines = fix!.edit!.insertedLines.split("\n").filter((l) => l.includes("create policy"));
    expect(policyLines.length).toBeGreaterThan(0);
    for (const line of policyLines) expect(line.trim().startsWith("--")).toBe(true);
  });

  it("handles a single-line create table (anchor collapses to one line)", () => {
    const oneLine = "create table orders (id int, org_id uuid);\n";
    const fix = generateSuggestedFix(
      makeFinding("rls-gap", {
        locations: [{ path: "s.sql", startLine: 1, endLine: 1, surface: "app_code" }],
      }),
      source("s.sql", oneLine),
    );
    expect(fix!.edit!.startLine).toBe(1);
    expect(fix!.edit!.endLine).toBe(1);
    expect(fix!.edit!.insertedLines).toContain("alter table orders enable row level security;");
  });

  it("degrades to guidance — never to a wrong edit — when the source is unavailable", () => {
    const fix = generateSuggestedFix(finding);
    expect(fix!.kind).toBe("agent_guidance");
    expect(fix!.edit).toBeUndefined();
  });

  it("degrades to guidance when the anchor line is not a create table after all", () => {
    const fix = generateSuggestedFix(finding, source("db/schema.sql", "select 1;\n"));
    expect(fix!.kind).toBe("agent_guidance");
  });

  it("degrades to guidance when the statement has no terminator", () => {
    const fix = generateSuggestedFix(finding, source("db/schema.sql", "create table invoices (\n  id int\n"));
    expect(fix!.kind).toBe("agent_guidance");
  });
});

describe("generateSuggestedFix — tool guidance is derived from the parsed tool", () => {
  const toolDefs = JSON.stringify(
    {
      tools: [
        { name: "search", parameters: { query: { type: "string" }, limit: { type: "number" } } },
        { name: "other", parameters: { ok: { type: "string", maxLength: 10 } } },
      ],
    },
    null,
    2,
  );

  /** Line where `"search"` appears in the pretty-printed JSON above. */
  const searchLine = toolDefs.split("\n").findIndex((l) => l.includes('"search"')) + 1;

  it("names the specific unbounded parameters and the right bound for each type", () => {
    const fix = generateSuggestedFix(
      makeFinding("unbounded-tool-param", {
        locations: [{ path: "tools.json", startLine: searchLine, endLine: searchLine, surface: "tool_defs" }],
      }),
      source("tools.json", toolDefs),
    );
    expect(fix!.content).toContain('"query"');
    expect(fix!.content).toContain("maxLength");
    expect(fix!.content).toContain('"limit"');
    expect(fix!.content).toContain("maximum");
    // The bounded parameter on the OTHER tool must not be dragged in.
    expect(fix!.content).not.toContain('"ok"');
  });

  it("still gives usable guidance when the tool definition cannot be parsed", () => {
    const fix = generateSuggestedFix(
      makeFinding("unbounded-tool-param", {
        locations: [{ path: "tools.json", startLine: 1, endLine: 1, surface: "tool_defs" }],
      }),
      source("tools.json", "{ not json"),
    );
    expect(fix!.kind).toBe("agent_guidance");
    expect(fix!.content).toContain("maxLength");
  });

  it("says a tool with no parameter schema at all has nothing constraining it", () => {
    const noParams = JSON.stringify({ tools: [{ name: "run" }] }, null, 2);
    const line = noParams.split("\n").findIndex((l) => l.includes('"run"')) + 1;
    const fix = generateSuggestedFix(
      makeFinding("missing-schema-validation", {
        locations: [{ path: "t.json", startLine: line, endLine: line, surface: "tool_defs" }],
      }),
      source("t.json", noParams),
    );
    expect(fix!.content).toMatch(/no parameter schema at all/i);
  });
});

describe("generateSuggestedFix — research-tier guidance is hedged", () => {
  it("tells the reader to confirm a research finding before changing anything", () => {
    const fix = generateSuggestedFix(
      makeFinding("over-permissioned-loop", { tier: "research", confidence: 0.62, reproduction: undefined }),
    );
    expect(fix!.content).toMatch(/research-tier/i);
    expect(fix!.content).toMatch(/confirm/i);
  });

  it("does not hedge a verified finding", () => {
    const fix = generateSuggestedFix(makeFinding("cors-misconfig"));
    expect(fix!.content).not.toMatch(/research-tier/i);
  });
});

describe("generateSuggestedFix — rls-gap scoping-column detection", () => {
  /*
   * Compact single-line DDL puts every column after the first on the same line. A
   * line-anchored column scan reports "no scoping column found" for it, which is a quiet
   * downgrade in guidance quality for exactly the SQL people write by hand.
   */
  it("finds a scoping column that is not the first on its line", () => {
    const fix = generateSuggestedFix(
      makeFinding("rls-gap", { locations: [{ path: "s.sql", startLine: 1, endLine: 1, surface: "app_code" }] }),
      source("s.sql", "create table sessions (id uuid primary key, user_id uuid not null);\n"),
    );
    expect(fix!.edit!.insertedLines).toContain("user_id");
    expect(fix!.edit!.insertedLines).not.toMatch(/No obvious scoping column/);
  });

  it("says so plainly when the DDL really has no scoping column", () => {
    const fix = generateSuggestedFix(
      makeFinding("rls-gap", { locations: [{ path: "s.sql", startLine: 1, endLine: 1, surface: "app_code" }] }),
      source("s.sql", "create table audit_log (id bigserial primary key, action text);\n"),
    );
    expect(fix!.edit!.insertedLines).toMatch(/No obvious scoping column/);
    // It must still enable RLS — the mechanical half of the fix does not depend on the guess.
    expect(fix!.edit!.insertedLines).toContain("alter table audit_log enable row level security;");
  });
});
