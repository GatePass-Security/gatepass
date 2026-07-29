import { parseFindingsDocument } from "@gatepass/findings";

/**
 * Self-hosted runner protocol (contracts/runner-protocol.md). The runner uploads findings +
 * posture ONLY — never source code. These guards enforce that structurally: the payload must
 * be a valid findings document, must carry no source-bearing fields, and oversized text
 * fields are rejected rather than accepted.
 */

export class RunnerUploadError extends Error {}

/** Keys that would smuggle source code through the results endpoint. */
const FORBIDDEN_KEYS = new Set(["content", "source", "filecontent", "filecontents", "raw", "body", "blob", "snippet"]);
const MAX_TEXT = 4096;

/**
 * The one place a forbidden key name is legitimate: `suggestedFix.content` is the canonical
 * schema's name for a fix's human-readable rationale, and it predates this guard.
 *
 * Scoping the exemption to that exact parent — rather than dropping "content" from the
 * forbidden set — keeps the guard's real job intact: a `content` field anywhere else, which
 * is where a source dump would actually appear, is still rejected. `suggestedFix` itself is
 * bounded by the same MAX_TEXT ceiling as every other string, and its `insertedLines` are
 * generated remediation text by construction (findings-schema contract), not a copy of the
 * customer's file.
 *
 * Until suggested fixes were generated in the pipeline this never fired, because nothing
 * ever populated the field — the guard and the schema had simply never met.
 */
const ALLOWED_CONTENT_PARENTS = new Set(["suggestedfix"]);

function isExempt(key: string, parentKey: string | undefined): boolean {
  return key.toLowerCase() === "content" && parentKey !== undefined && ALLOWED_CONTENT_PARENTS.has(parentKey);
}

function scan(value: unknown, path: string, parentKey?: string): void {
  if (typeof value === "string") {
    if (value.length > MAX_TEXT) throw new RunnerUploadError(`oversized text field at ${path} (${value.length} chars)`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => scan(v, `${path}[${i}]`, parentKey));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase()) && !isExempt(k, parentKey)) {
        throw new RunnerUploadError(`forbidden source-bearing field "${k}" at ${path}`);
      }
      scan(v, `${path}.${k}`, k.toLowerCase());
    }
  }
}

/** Validate an inbound runner results upload. Throws on any violation. */
export function validateRunnerUpload(payload: unknown): void {
  scan(payload, "$");
  parseFindingsDocument(payload); // must also be a schema-valid findings document
}

export const HANDSHAKE_OK = "accept" as const;
export const HANDSHAKE_UPGRADE = "upgrade_required" as const;

/** Runner handshake version-floor check (R10): reject runners below the org's minimum. */
export function handshake(
  runnerRulesetVersion: string,
  minRulesetVersion: string,
): { status: typeof HANDSHAKE_OK } | { status: typeof HANDSHAKE_UPGRADE; httpStatus: 426 } {
  if (compareVersions(runnerRulesetVersion, minRulesetVersion) < 0) {
    return { status: HANDSHAKE_UPGRADE, httpStatus: 426 };
  }
  return { status: HANDSHAKE_OK };
}

/** Compare dotted versions numerically (e.g. "2026.7.0" vs "2026.07.1"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
