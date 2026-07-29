import { describe, it, expect } from "vitest";
import { redactSecrets, assertRedacted, assertFixRedacted, RedactionError } from "../src/index.js";

describe("redactSecrets", () => {
  it("replaces a known secret value with «REDACTED»", () => {
    const result = redactSecrets("The key is AKIA3M7QZKPBW4NVXR2T", ["AKIA3M7QZKPBW4NVXR2T"]);
    expect(result).toBe("The key is «REDACTED»");
  });

  it("handles empty secrets array without modifying text", () => {
    const result = redactSecrets("some text", []);
    expect(result).toBe("some text");
  });

  it("does not modify text that contains no secret values", () => {
    const result = redactSecrets("just regular text", ["secret123"]);
    expect(result).toBe("just regular text");
  });

  it("skips empty strings in the secrets array", () => {
    const result = redactSecrets("hello world", ["", "world", ""]);
    expect(result).toBe("hello «REDACTED»");
  });

  it("redacts multiple occurrences of the same secret", () => {
    const result = redactSecrets("token=abc token=abc", ["abc"]);
    expect(result).toBe("token=«REDACTED» token=«REDACTED»");
  });

  it("redacts multiple different secrets", () => {
    const result = redactSecrets("user: admin, pass: s3cret", ["admin", "s3cret"]);
    expect(result).toBe("user: «REDACTED», pass: «REDACTED»");
  });
});

describe("assertRedacted", () => {
  it("passes when no secrets leak into reproduction steps or expected", () => {
    const repro = { kind: "inspection" as const, steps: ["Open file"], expected: "no secrets here" };
    expect(() => assertRedacted(repro, ["secret123", "password456"])).not.toThrow();
  });

  it("throws RedactionError when a secret leaks into reproduction steps", () => {
    const repro = {
      kind: "inspection" as const,
      steps: ["The key is AKIA3M7QZKPBW4NVXR2T"],
      expected: "x",
    };
    expect(() => assertRedacted(repro, ["AKIA3M7QZKPBW4NVXR2T"])).toThrow(RedactionError);
  });

  it("throws RedactionError when a secret leaks into expected", () => {
    const repro = { kind: "inspection" as const, steps: ["Step 1"], expected: "secret: sk_live_abc123" };
    expect(() => assertRedacted(repro, ["sk_live_abc123"])).toThrow(RedactionError);
  });

  it("reports all leaked secrets via RedactionError.leaked", () => {
    const repro = {
      kind: "inspection" as const,
      steps: ["key=AKIA123 and pw=secret!"],
      expected: "x",
    };
    let err: RedactionError | undefined;
    try {
      assertRedacted(repro, ["AKIA123", "secret!"]);
    } catch (e) {
      err = e as RedactionError;
    }
    expect(err).toBeInstanceOf(RedactionError);
    expect(err!.leaked).toEqual(["AKIA123", "secret!"]);
  });

  it("skips empty secrets when checking for leaks but still catches real ones", () => {
    const repro = { kind: "inspection" as const, steps: ["leaked secret"], expected: "x" };
    expect(() => assertRedacted(repro, ["", "secret"])).toThrow(RedactionError);
  });

  it("passes when only empty strings are in secrets array", () => {
    const repro = { kind: "inspection" as const, steps: ["some text"], expected: "x" };
    expect(() => assertRedacted(repro, ["", ""])).not.toThrow();
  });
});

describe("RedactionError", () => {
  it("has the correct name property", () => {
    const err = new RedactionError(["key1"]);
    expect(err.name).toBe("RedactionError");
  });

  it("includes the leak count in its message", () => {
    const err = new RedactionError(["key1", "key2"]);
    expect(err.message).toContain("2");
    expect(err.message).toContain("leak");
  });

  it("exposes the leaked secrets array", () => {
    const leaked = ["key1", "key2"];
    const err = new RedactionError(leaked);
    expect(err.leaked).toBe(leaked);
  });

  it("is an instance of Error", () => {
    const err = new RedactionError(["x"]);
    expect(err).toBeInstanceOf(Error);
  });
});

/**
 * A suggested fix is generated from the same file a secret was found in, and it travels
 * further than a reproduction does — into a PR comment, and into a branch if someone opens a
 * fix pull request. So it gets the identical check rather than trusting fix generation to be
 * careful on its own.
 */
describe("assertFixRedacted", () => {
  const secret = "AKIA3M7QZKPBW4NVXR2T";

  it("passes a fix that never mentions the secret", () => {
    expect(() =>
      assertFixRedacted({ kind: "agent_guidance", content: "Rotate the credential at the provider." }, [secret]),
    ).not.toThrow();
  });

  it("throws when the rationale quotes the secret verbatim", () => {
    expect(() =>
      assertFixRedacted({ kind: "agent_guidance", content: `Remove ${secret} from source.` }, [secret]),
    ).toThrow(RedactionError);
  });

  it("throws when the inserted lines carry the secret — the half that would be committed", () => {
    expect(() =>
      assertFixRedacted(
        {
          kind: "diff",
          content: "why",
          edit: {
            path: "a.ts",
            startLine: 1,
            endLine: 1,
            operation: "insert_after",
            insertedLines: `const key = "${secret}";`,
          },
        },
        [secret],
      ),
    ).toThrow(RedactionError);
  });

  it("ignores an empty secret rather than matching everything", () => {
    expect(() => assertFixRedacted({ kind: "agent_guidance", content: "anything" }, [""])).not.toThrow();
  });
});
