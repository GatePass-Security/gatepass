import { describe, it, expect } from "vitest";
import {
  hashToken,
  generateToken,
  safeEqual,
  verifyHmac,
  redactForLog,
  InMemoryTracer,
  timed,
  expiredArtifacts,
  isExpired,
  DEFAULT_TTL_DAYS,
  EVIDENCE_TTL_DAYS,
  type Artifact,
} from "../src/index.js";
import { createHmac } from "node:crypto";

describe("crypto helpers (T099)", () => {
  it("hashes tokens deterministically and never returns the input", () => {
    expect(hashToken("secret")).toBe(hashToken("secret"));
    expect(hashToken("secret")).not.toContain("secret");
  });
  it("generates distinct random tokens", () => {
    expect(generateToken()).not.toBe(generateToken());
  });
  it("compares in constant time and rejects mismatches", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("verifies an HMAC webhook signature", () => {
    const sig = "sha256=" + createHmac("sha256", "whsec").update("payload").digest("hex");
    expect(verifyHmac("payload", "whsec", sig)).toBe(true);
    expect(verifyHmac("payload", "whsec", "sha256=deadbeef")).toBe(false);
  });
  it("redacts secret-shaped substrings for logging", () => {
    expect(redactForLog("key=AKIA3M7QZKPBW4NVXR2T")).toContain("«AWS_KEY»");
    expect(redactForLog("key=AKIA3M7QZKPBW4NVXR2T")).not.toContain("AKIA3M7QZKPBW4NVXR2T");
  });
});

describe("telemetry (T099)", () => {
  it("records span durations and counters", async () => {
    const tracer = new InMemoryTracer();
    const span = tracer.startSpan("parse", { files: 10 });
    span.end();
    tracer.counter("scans");
    tracer.counter("scans");
    expect(tracer.spans[0]!.name).toBe("parse");
    expect(tracer.spans[0]!.attributes.files).toBe(10);
    expect(tracer.counters.get("scans")).toBe(2);
  });
  it("timed() records a span around an async stage", async () => {
    const r = await timed("detect", async () => 42);
    expect(r).toBe(42);
  });
});

describe("artifact retention (FR-026, T066)", () => {
  const now = new Date("2026-07-09T00:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

  it("expires ordinary artifacts past the default TTL", () => {
    const a: Artifact = { id: "1", createdAt: daysAgo(DEFAULT_TTL_DAYS + 1), backsEvidence: false };
    expect(isExpired(a, now)).toBe(true);
  });
  it("keeps ordinary artifacts within the default TTL", () => {
    const a: Artifact = { id: "1", createdAt: daysAgo(DEFAULT_TTL_DAYS - 1), backsEvidence: false };
    expect(isExpired(a, now)).toBe(false);
  });
  it("retains evidence-backing artifacts longer", () => {
    const a: Artifact = { id: "1", createdAt: daysAgo(DEFAULT_TTL_DAYS + 5), backsEvidence: true };
    expect(isExpired(a, now)).toBe(false);
    const old: Artifact = { id: "2", createdAt: daysAgo(EVIDENCE_TTL_DAYS + 1), backsEvidence: true };
    expect(isExpired(old, now)).toBe(true);
  });
  it("selects only expired artifacts for a sweep", () => {
    const artifacts: Artifact[] = [
      { id: "keep", createdAt: daysAgo(5), backsEvidence: false },
      { id: "drop", createdAt: daysAgo(60), backsEvidence: false },
    ];
    expect(expiredArtifacts(artifacts, now).map((a) => a.id)).toEqual(["drop"]);
  });
});
