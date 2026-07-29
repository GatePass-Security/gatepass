import { describe, it, expect } from "vitest";
import {
  applyFixEdit,
  applyFixEdits,
  anchorLines,
  splitLines,
  joinLines,
  FixEditError,
  parseFinding,
  type FixEdit,
} from "../src/index.js";

const edit = (over: Partial<FixEdit> = {}): FixEdit => ({
  path: "a.sql",
  startLine: 1,
  endLine: 2,
  operation: "insert_after",
  insertedLines: "ADDED",
  ...over,
});

describe("splitLines / joinLines", () => {
  it("round-trips a file that ends with a newline", () => {
    const content = "a\nb\n";
    const { lines, trailingNewline } = splitLines(content);
    expect(lines).toEqual(["a", "b"]);
    expect(joinLines(lines, trailingNewline)).toBe(content);
  });

  it("round-trips a file that does NOT end with a newline", () => {
    const content = "a\nb";
    const { lines, trailingNewline } = splitLines(content);
    expect(trailingNewline).toBe(false);
    expect(joinLines(lines, trailingNewline)).toBe(content);
  });
});

describe("anchorLines", () => {
  it("returns the 1-indexed inclusive range", () => {
    expect(anchorLines("a\nb\nc\n", edit({ startLine: 2, endLine: 3 }))).toEqual(["b", "c"]);
  });

  it("returns undefined when the range runs past the end of the file", () => {
    expect(anchorLines("a\n", edit({ startLine: 1, endLine: 4 }))).toBeUndefined();
  });
});

describe("applyFixEdit", () => {
  it("inserts after the anchor and removes nothing", () => {
    expect(applyFixEdit("a\nb\nc\n", edit({ startLine: 1, endLine: 2 }))).toBe("a\nb\nADDED\nc\n");
  });

  it("appends at the end of the file", () => {
    expect(applyFixEdit("a\nb\n", edit({ startLine: 2, endLine: 2 }))).toBe("a\nb\nADDED\n");
  });

  it("preserves a missing trailing newline", () => {
    expect(applyFixEdit("a\nb", edit({ startLine: 1, endLine: 1 }))).toBe("a\nADDED\nb");
  });

  it("inserts multiple lines in order", () => {
    expect(applyFixEdit("a\n", edit({ startLine: 1, endLine: 1, insertedLines: "x\ny" }))).toBe("a\nx\ny\n");
  });

  /* Landing on the wrong lines is worse than not landing at all. */
  it("throws rather than clamping an out-of-bounds anchor", () => {
    expect(() => applyFixEdit("a\n", edit({ startLine: 1, endLine: 9 }))).toThrow(FixEditError);
  });
});

describe("applyFixEdits", () => {
  it("applies bottom-up so earlier anchors are not shifted by later insertions", () => {
    const result = applyFixEdits("a\nb\nc\n", [
      edit({ startLine: 1, endLine: 1, insertedLines: "AFTER-A" }),
      edit({ startLine: 3, endLine: 3, insertedLines: "AFTER-C" }),
    ]);
    expect(result).toBe("a\nAFTER-A\nb\nc\nAFTER-C\n");
  });

  it("is order-independent — the same edits in any order give the same file", () => {
    const a = edit({ startLine: 1, endLine: 1, insertedLines: "ONE" });
    const b = edit({ startLine: 3, endLine: 3, insertedLines: "TWO" });
    expect(applyFixEdits("a\nb\nc\n", [a, b])).toBe(applyFixEdits("a\nb\nc\n", [b, a]));
  });

  it("rejects overlapping anchors rather than picking a winner", () => {
    expect(() =>
      applyFixEdits("a\nb\nc\n", [edit({ startLine: 1, endLine: 2 }), edit({ startLine: 2, endLine: 3 })]),
    ).toThrow(/overlapping fix edits/);
  });
});

describe("suggestedFix schema invariant", () => {
  const base = {
    fingerprint: "sha256:x",
    tier: "verified" as const,
    classId: "rls-gap",
    severity: "high" as const,
    surfaces: ["app_code"],
    locations: [{ path: "a.sql", startLine: 1, endLine: 1, surface: "app_code" }],
    explanation: "e",
    reproduction: { kind: "inspection" as const, steps: ["s"], expected: "x" },
  };

  it("accepts a diff that carries an applicable edit", () => {
    const parsed = parseFinding({
      ...base,
      suggestedFix: {
        kind: "diff",
        content: "why",
        edit: { path: "a.sql", startLine: 1, endLine: 1, insertedLines: "x" },
      },
    });
    // `operation` defaults rather than being required on the wire.
    expect(parsed.suggestedFix!.edit!.operation).toBe("insert_after");
  });

  /*
   * The bug this schema exists to make impossible: a "diff" whose payload is prose. Rendered
   * as a GitHub suggestion, applying it would replace the developer's line with a comment.
   */
  it("rejects a diff with no edit", () => {
    expect(() => parseFinding({ ...base, suggestedFix: { kind: "diff", content: "// just a comment" } })).toThrow();
  });

  it("rejects guidance that smuggles in an edit", () => {
    expect(() =>
      parseFinding({
        ...base,
        suggestedFix: {
          kind: "agent_guidance",
          content: "prose",
          edit: { path: "a.sql", startLine: 1, endLine: 1, insertedLines: "x" },
        },
      }),
    ).toThrow();
  });

  it("rejects an inverted anchor range", () => {
    expect(() =>
      parseFinding({
        ...base,
        suggestedFix: {
          kind: "diff",
          content: "why",
          edit: { path: "a.sql", startLine: 5, endLine: 2, insertedLines: "x" },
        },
      }),
    ).toThrow();
  });

  it("still accepts a finding with no suggestedFix at all (backward compatible)", () => {
    expect(() => parseFinding(base)).not.toThrow();
  });
});
