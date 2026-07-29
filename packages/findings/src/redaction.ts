import type { Reproduction, SuggestedFix } from "./schema.js";

/**
 * Redaction linter (contracts/findings-schema.md rule 5): a verified finding's
 * reproduction steps must never contain a secret value verbatim. Producers pass the
 * raw secret values they detected; this asserts none leak into the reproduction.
 */
export class RedactionError extends Error {
  constructor(public readonly leaked: string[]) {
    super(`Reproduction leaks ${leaked.length} secret value(s) verbatim`);
    this.name = "RedactionError";
  }
}

const PLACEHOLDER = "«REDACTED»";

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join(PLACEHOLDER);
  }
  return out;
}

export function assertRedacted(reproduction: Reproduction, secrets: readonly string[]): void {
  const haystack = [...reproduction.steps, reproduction.expected].join("\n");
  const leaked = secrets.filter((s) => s.length > 0 && haystack.includes(s));
  if (leaked.length > 0) throw new RedactionError(leaked);
}

/**
 * The same rule for suggested fixes. A fix is generated from the file the secret was found
 * in and is delivered further than a reproduction ever is — into a PR comment, and into a
 * branch if someone opens a fix pull request — so it gets the identical check rather than
 * relying on fix generation to be careful.
 */
export function assertFixRedacted(fix: SuggestedFix, secrets: readonly string[]): void {
  const haystack = [fix.content, fix.edit?.insertedLines ?? ""].join("\n");
  const leaked = secrets.filter((s) => s.length > 0 && haystack.includes(s));
  if (leaked.length > 0) throw new RedactionError(leaked);
}
