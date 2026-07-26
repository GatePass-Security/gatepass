import { describe, it, expect } from "vitest";
import {
  ASI_CATEGORIES,
  ASI_IDS,
  asiForClass,
  asiCategory,
  coveredAsiIds,
  asiCoverageSummary,
} from "../src/owasp-asi.js";

/** The 12 vulnerability classes the deterministic engine ships. */
const ENGINE_CLASSES = [
  "exposed-secret",
  "cors-misconfig",
  "unpinned-dependency",
  "missing-schema-validation",
  "rls-gap",
  "unauth-mcp-transport",
  "unbounded-tool-param",
  "tool-poisoning",
  "confused-deputy",
  "hbv",
  "over-permissioned-loop",
  "cross-surface-scope-mismatch",
];

describe("OWASP ASI (2026) mapping", () => {
  it("defines all ten categories exactly once, in order", () => {
    expect(ASI_CATEGORIES).toHaveLength(10);
    expect(ASI_CATEGORIES.map((c) => c.id)).toEqual([...ASI_IDS]);
  });

  it("every category has a title, summary, and explicit coverage verdict", () => {
    for (const c of ASI_CATEGORIES) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.summary.length).toBeGreaterThan(0);
      expect(["full", "partial", "none"]).toContain(c.coverage);
    }
  });

  it("states a limitation wherever coverage is not full (no silent overclaiming)", () => {
    for (const c of ASI_CATEGORIES.filter((x) => x.coverage !== "full")) {
      expect(c.limitation, `${c.id} claims ${c.coverage} coverage without stating a limitation`).toBeTruthy();
    }
  });

  it("never claims coverage without at least one detector behind it", () => {
    for (const c of ASI_CATEGORIES) {
      if (c.coverage === "none") expect(c.classIds).toHaveLength(0);
      else expect(c.classIds.length, `${c.id} claims ${c.coverage} coverage but maps no class`).toBeGreaterThan(0);
    }
  });

  it("only maps classes the engine actually ships", () => {
    for (const c of ASI_CATEGORIES) {
      for (const classId of c.classIds) {
        expect(ENGINE_CLASSES, `${c.id} maps unknown class '${classId}'`).toContain(classId);
      }
    }
  });

  it("maps every engine class to at least one ASI category", () => {
    // cors-misconfig and rls-gap are app-code classes; rls-gap maps to ASI03. cors-misconfig is
    // intentionally NOT an agentic category — assert the rest are all mapped.
    const unmapped = ENGINE_CLASSES.filter((c) => c !== "cors-misconfig" && asiForClass(c).length === 0);
    expect(unmapped, `unmapped classes: ${unmapped.join(", ")}`).toHaveLength(0);
  });

  it("resolves classes to the expected categories", () => {
    expect(asiForClass("tool-poisoning")).toContain("ASI01");
    expect(asiForClass("unbounded-tool-param")).toContain("ASI02");
    expect(asiForClass("confused-deputy")).toContain("ASI03");
    expect(asiForClass("unpinned-dependency")).toContain("ASI04");
    expect(asiForClass("over-permissioned-loop")).toContain("ASI10");
  });

  it("returns an empty list for an unknown class", () => {
    expect(asiForClass("not-a-real-class")).toEqual([]);
  });

  it("looks up a category by id", () => {
    expect(asiCategory("ASI06")?.title).toMatch(/Memory/i);
  });

  it("honestly reports ASI06 (memory poisoning) as the uncovered gap", () => {
    const summary = asiCoverageSummary();
    expect(summary.none).toEqual(["ASI06"]);
    expect(asiCategory("ASI06")!.limitation).toMatch(/roadmap|not yet/i);
  });

  it("covers 9 of 10 categories with at least one detector", () => {
    expect(coveredAsiIds()).toHaveLength(9);
  });

  it("summary partitions all ten categories with no overlap", () => {
    const s = asiCoverageSummary();
    const all = [...s.full, ...s.partial, ...s.none];
    expect(all).toHaveLength(10);
    expect(new Set(all).size).toBe(10);
  });
});
