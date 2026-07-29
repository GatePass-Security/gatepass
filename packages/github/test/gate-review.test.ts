import { describe, it, expect } from "vitest";
import { evaluateGate, buildReview, type GateConfig } from "../src/index.js";
import type { Finding } from "@gatepass/findings";

const verified: Finding = {
  fingerprint: "sha256:a",
  tier: "verified",
  classId: "exposed-secret",
  severity: "critical",
  surfaces: ["app_code"],
  locations: [{ path: "a.js", startLine: 1, endLine: 1, surface: "app_code" }],
  explanation: "secret",
  reproduction: { kind: "inspection", steps: ["look"], expected: "leak" },
};
const research: Finding = {
  fingerprint: "sha256:b",
  tier: "research",
  classId: "tool-poisoning",
  severity: "medium",
  surfaces: ["tool_defs"],
  locations: [{ path: "t.json", startLine: 2, endLine: 2, surface: "tool_defs" }],
  explanation: "maybe poisoned",
  confidence: 0.6,
};

describe("CI gate decision (FR-016, FR-016a)", () => {
  const failOpen: GateConfig = { mode: "block_verified", failureMode: "fail_open" };

  it("blocks on a verified finding in block_verified mode", () => {
    const r = evaluateGate(failOpen, { findings: [verified, research], scanCompleted: true });
    expect(r.conclusion).toBe("failure");
    expect(r.blocking).toHaveLength(1);
  });

  it("does not block on research-only findings in block_verified mode", () => {
    const r = evaluateGate(failOpen, { findings: [research], scanCompleted: true });
    expect(r.conclusion).toBe("success");
  });

  it("fails OPEN (neutral) when the scan did not complete", () => {
    const r = evaluateGate(failOpen, { scanCompleted: false });
    expect(r.conclusion).toBe("neutral");
  });

  it("fails CLOSED (failure) on incomplete scan when configured", () => {
    const r = evaluateGate({ mode: "block_verified", failureMode: "fail_closed" }, { scanCompleted: false });
    expect(r.conclusion).toBe("failure");
  });

  it("block_threshold respects minSeverity and maxAllowed", () => {
    const cfg: GateConfig = {
      mode: "block_threshold",
      failureMode: "fail_open",
      threshold: { minSeverity: "high", maxAllowed: 0 },
    };
    expect(evaluateGate(cfg, { findings: [research], scanCompleted: true }).conclusion).toBe("success"); // medium < high
    expect(evaluateGate(cfg, { findings: [verified], scanCompleted: true }).conclusion).toBe("failure"); // critical >= high
  });

  it("off mode never blocks", () => {
    const r = evaluateGate({ mode: "off", failureMode: "fail_open" }, { findings: [verified], scanCompleted: true });
    expect(r.conclusion).toBe("neutral");
  });
});

describe("PR review builder (FR-012)", () => {
  it("emits COMMENT event (never auto-changing) with per-finding comments", () => {
    const review = buildReview([verified, research]);
    expect(review.event).toBe("COMMENT");
    expect(review.comments).toHaveLength(2);
  });

  it("shows a reproduction for verified and confidence for research", () => {
    const review = buildReview([verified, research]);
    expect(review.comments[0]!.body).toContain("Reproduction");
    expect(review.comments[1]!.body).toContain("confidence");
  });

  it("summary states suggestions are advisory", () => {
    expect(buildReview([verified]).summary).toMatch(/advisory|approve/i);
  });
});

/**
 * A GitHub ```suggestion``` block REPLACES the lines its comment is anchored to, and a
 * reviewer applies it with one click. Every test here exists because the obvious
 * implementation of an *insertion* fix — fencing `insertedLines` on their own — would tell
 * GitHub to delete the developer's code.
 */
describe("PR review builder — suggestion safety", () => {
  const sqlLines = [
    "create table invoices (", // 1
    "  id uuid primary key,", // 2
    "  tenant_id uuid not null", // 3
    ");", // 4
  ];
  const sql = sqlLines.join("\n") + "\n";

  const withFix: Finding = {
    fingerprint: "sha256:c",
    tier: "verified",
    classId: "rls-gap",
    severity: "high",
    surfaces: ["app_code"],
    locations: [{ path: "db/schema.sql", startLine: 1, endLine: 1, surface: "app_code" }],
    explanation: "no RLS",
    reproduction: { kind: "inspection", steps: ["look"], expected: "cross-tenant read" },
    suggestedFix: {
      kind: "diff",
      content: "Enable row-level security.",
      edit: {
        path: "db/schema.sql",
        startLine: 1,
        endLine: 4,
        operation: "insert_after",
        insertedLines: "\nalter table invoices enable row level security;",
      },
    },
  };

  const source = { read: (p: string) => (p === "db/schema.sql" ? sql : undefined) };

  function suggestionBody(body: string): string[] {
    const lines = body.split("\n");
    const start = lines.indexOf("```suggestion");
    if (start === -1) return [];
    const end = lines.indexOf("```", start + 1);
    return lines.slice(start + 1, end);
  }

  it("includes the original anchor lines before the insertion, so applying it adds rather than replaces", () => {
    const [comment] = buildReview([withFix], { source }).comments;
    const suggestion = suggestionBody(comment!.body);
    // The developer's four lines must survive verbatim, in order, at the top.
    expect(suggestion.slice(0, 4)).toEqual(sqlLines);
    expect(suggestion).toContain("alter table invoices enable row level security;");
  });

  it("NEVER emits a suggestion containing only the insertion (applying it would delete code)", () => {
    for (const opts of [{ source }, {}]) {
      const [comment] = buildReview([withFix], opts).comments;
      const suggestion = suggestionBody(comment!.body);
      if (suggestion.length === 0) continue; // rendered as a copy-paste block instead — fine
      expect(suggestion[0]).toBe(sqlLines[0]);
      expect(suggestion.join("\n")).toContain("create table invoices (");
    }
  });

  it("anchors a multi-line suggestion across its whole range", () => {
    const [comment] = buildReview([withFix], { source }).comments;
    expect(comment!.startLine).toBe(1);
    expect(comment!.line).toBe(4);
  });

  it("omits startLine for a single-line anchor", () => {
    const single: Finding = {
      ...withFix,
      suggestedFix: { ...withFix.suggestedFix!, edit: { ...withFix.suggestedFix!.edit!, endLine: 1 } },
    };
    const [comment] = buildReview([single], { source }).comments;
    expect(comment!.startLine).toBeUndefined();
    expect(comment!.line).toBe(1);
  });

  it("degrades to a copy-paste block when the source is unavailable", () => {
    const [comment] = buildReview([withFix]).comments;
    expect(comment!.body).not.toContain("```suggestion");
    expect(comment!.body).toContain("Add after line 4");
    expect(comment!.body).toContain("alter table invoices enable row level security;");
  });

  it("degrades to a copy-paste block when the file moved and the anchor no longer exists", () => {
    const shortened = { read: () => "create table invoices (id int);\n" };
    const [comment] = buildReview([withFix], { source: shortened }).comments;
    expect(comment!.body).not.toContain("```suggestion");
  });

  it("renders guidance as prose with no suggestion block at all", () => {
    const guided: Finding = {
      ...withFix,
      classId: "cors-misconfig",
      suggestedFix: { kind: "agent_guidance", content: "Replace the wildcard with an allow-list." },
    };
    const [comment] = buildReview([guided], { source }).comments;
    expect(comment!.body).toContain("Replace the wildcard with an allow-list.");
    expect(comment!.body).not.toContain("```suggestion");
  });
});
