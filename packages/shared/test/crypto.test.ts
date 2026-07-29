import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { hashToken, generateToken, safeEqual, verifyHmac, redactForLog } from "../src/index.js";

describe("hashToken", () => {
  it("produces a hex string", () => {
    const hash = hashToken("hello");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic (same input = same output)", () => {
    expect(hashToken("hello")).toBe(hashToken("hello"));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken("hello")).not.toBe(hashToken("world"));
  });
});

describe("generateToken", () => {
  it("produces a string of expected length (default 32 bytes = 64 hex chars)", () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces unique values each call", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
  });

  it("respects a custom byte length", () => {
    const token = generateToken(16);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("safeEqual", () => {
  it("returns true for equal strings", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(safeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for different length strings", () => {
    expect(safeEqual("short", "a-very-long-string-that-differs")).toBe(false);
  });
});

describe("verifyHmac", () => {
  it("validates correct signature", () => {
    const payload = '{"event":"push"}';
    const secret = "my-webhook-secret";
    const signature = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    expect(verifyHmac(payload, secret, signature)).toBe(true);
  });

  it("rejects wrong signature", () => {
    const payload = '{"event":"push"}';
    const secret = "my-webhook-secret";
    const signature = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    expect(verifyHmac(payload, secret + "-wrong", signature)).toBe(false);
  });

  it("rejects a tampered payload with the same secret", () => {
    const payload = '{"event":"push"}';
    const tampered = '{"event":"delete"}';
    const secret = "my-webhook-secret";
    const signature = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    expect(verifyHmac(tampered, secret, signature)).toBe(false);
  });
});

describe("redactForLog", () => {
  it("redacts AWS access keys (AKIA...)", () => {
    const result = redactForLog("AKIA3M7QZKPBW4NVXR2T");
    expect(result).toBe("«AWS_KEY»");
  });

  it("redacts AWS keys embedded in text", () => {
    const result = redactForLog('key="AKIA3M7QZKPBW4NVXR2T", region="us-east-1"');
    expect(result).toContain("«AWS_KEY»");
    expect(result).not.toContain("AKIA3M7QZKPBW4NVXR2T");
  });

  it("redacts Anthropic API keys (sk-ant-...)", () => {
    const result = redactForLog("sk-ant-abcdef1234567890abcdef1234567890abcdef12");
    expect(result).toBe("«ANTHROPIC_KEY»");
  });

  it("redacts NVIDIA NIM API keys (nvapi-...)", () => {
    const result = redactForLog("nvapi-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF");
    expect(result).toBe("«NVIDIA_KEY»");
  });

  it("redacts NVIDIA keys embedded in text", () => {
    const key = "nvapi-abcdefghijklmnopqrstuvwxyz0123456789";
    const result = redactForLog(`key=${key} ok`);
    expect(result).toContain("«NVIDIA_KEY»");
    expect(result).not.toContain(key);
  });

  it("redacts general API keys (sk-...)", () => {
    const result = redactForLog("sk-abcdefghijklmnopqrstuvwxyz0123456789ab");
    expect(result).toBe("«API_KEY»");
  });

  it("redacts Authorization header values (generic bearer token)", () => {
    const result = redactForLog("authorization: bearer my-secret-token-value");
    expect(result).toMatch(/authorization:\s*bearer\s+«REDACTED»/i);
  });

  it("redacts Authorization header values with an API-key-shaped secret", () => {
    // An sk- prefixed secret is caught by the general API key pattern first
    const result = redactForLog("authorization: bearer sk-abcdefghijklmnopqrstuvwxyz0123456789ab");
    expect(result).not.toMatch(/sk-[A-Za-z0-9]{32,}/);
  });

  it("redacts Authorization header with mixed case", () => {
    const result = redactForLog("Authorization: Bearer my-secret-token-value");
    expect(result).toBe("Authorization: Bearer «REDACTED»");
  });

  it("does not modify normal text", () => {
    const text = "Hello, this is a normal log line without secrets.";
    expect(redactForLog(text)).toBe(text);
  });
});
