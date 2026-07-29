import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildScanContext } from "@gatepass/engine";
import { runScan } from "@gatepass/detectors";
import { validateRunnerUpload, RunnerUploadError, handshake, compareVersions } from "../src/index.js";

async function scanTree(files: Record<string, string>, mode: "hosted" | "runner" | "cli") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gp-run-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  const ctx = await buildScanContext(dir);
  const doc = runScan(ctx, { scanId: "x", rulesetVersion: "2026.07.0", executionMode: mode, semanticEnabled: true });
  await fs.rm(dir, { recursive: true, force: true });
  return doc;
}

const tree = {
  "dist/app.js": 'var k="AKIA3M7QZKPBW4NVXR2T";',
  "mcp/tools.json": JSON.stringify({ tools: [{ name: "q", parameters: { sql: { type: "string" } } }] }),
};

describe("runner results upload validation (FR-006a boundary)", () => {
  it("accepts a valid findings-only document", async () => {
    const doc = await scanTree(tree, "runner");
    expect(() => validateRunnerUpload(doc)).not.toThrow();
  });

  it("rejects a payload smuggling source via a 'content' field", async () => {
    const doc = (await scanTree(tree, "runner")) as any;
    doc.findings[0].content = "the entire source file...";
    expect(() => validateRunnerUpload(doc)).toThrow(RunnerUploadError);
  });

  it("rejects an oversized text field", async () => {
    const doc = (await scanTree(tree, "runner")) as any;
    doc.findings[0].explanation = "x".repeat(5000);
    expect(() => validateRunnerUpload(doc)).toThrow(RunnerUploadError);
  });
});

describe("hosted/runner parity (FR-006a)", () => {
  it("produces byte-identical fingerprints across hosted, runner, and cli modes", async () => {
    const hosted = await scanTree(tree, "hosted");
    const runner = await scanTree(tree, "runner");
    const cli = await scanTree(tree, "cli");
    const fp = (d: typeof hosted) => d.findings.map((f) => f.fingerprint);
    expect(fp(runner)).toEqual(fp(hosted));
    expect(fp(cli)).toEqual(fp(hosted));
  });
});

describe("handshake version floor (R10)", () => {
  it("accepts a runner at or above the minimum ruleset", () => {
    expect(handshake("2026.07.0", "2026.07.0").status).toBe("accept");
    expect(handshake("2026.08.0", "2026.07.0").status).toBe("accept");
  });
  it("returns 426 upgrade_required below the floor", () => {
    const r = handshake("2026.06.0", "2026.07.0");
    expect(r.status).toBe("upgrade_required");
    expect((r as { httpStatus: number }).httpStatus).toBe(426);
  });
  it("compares versions numerically", () => {
    expect(compareVersions("2026.7.0", "2026.07.1")).toBeLessThan(0);
    expect(compareVersions("2026.10.0", "2026.9.0")).toBeGreaterThan(0);
  });
});
