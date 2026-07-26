export * from "./schema.js";
export * from "./redaction.js";
export * from "./sarif.js";
export * from "./diff.js";
export * from "./owasp-asi.js";

import { findingSchema, findingsDocumentSchema, type Finding, type FindingsDocument } from "./schema.js";

/**
 * Parse an unknown value into a validated Finding. Throws (via zod) on any
 * tier-integrity violation or unknown tier — no third state can enter the system
 * (contracts/findings-schema.md rules 1-3).
 */
export function parseFinding(input: unknown): Finding {
  return findingSchema.parse(input);
}

export function parseFindingsDocument(input: unknown): FindingsDocument {
  return findingsDocumentSchema.parse(input);
}

export function safeParseFinding(input: unknown) {
  return findingSchema.safeParse(input);
}
