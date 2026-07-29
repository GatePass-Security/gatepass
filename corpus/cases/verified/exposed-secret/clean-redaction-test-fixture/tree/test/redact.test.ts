import { describe, expect, it } from "vitest";

import { REDACTION, redact, redactRecord } from "../src/redact";

// Every value below is a structurally valid but deliberately zeroed dummy.
// They exist so the redactor has something to chew on.
const SAMPLES = {
  aws: "AKIAIOSFODNN7EXAMPLE",
  githubPat: "ghp_0000000000000000000000000000000000",
  slackBot: "xoxb-000000000-0000000000",
  openai: "sk-000000000000000000000000000000000000000000000000",
  anthropic: "sk-ant-api03-0000000000000000000000000000000000000000000000",
  dsn: "postgres://svc:0000000000000000@db.internal:5432/app",
};

describe("redact", () => {
  it("scrubs every supported credential shape", () => {
    for (const [name, sample] of Object.entries(SAMPLES)) {
      expect(redact(`token=${sample}`), name).toBe(`token=${REDACTION}`);
    }
  });

  it("leaves ordinary text alone", () => {
    expect(redact("user 42 uploaded avatar.png")).toBe("user 42 uploaded avatar.png");
  });

  it("walks record values", () => {
    const out = redactRecord({ msg: `auth ${SAMPLES.githubPat}`, attempt: 3 });
    expect(out.msg).toBe(`auth ${REDACTION}`);
    expect(out.attempt).toBe(3);
  });
});
