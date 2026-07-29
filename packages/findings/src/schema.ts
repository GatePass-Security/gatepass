import { z } from "zod";

/**
 * Canonical Gatepass findings schema `gatepass.findings/1`.
 * See specs/001-gatepass-platform/contracts/findings-schema.md.
 *
 * The tier invariant (Constitution Principle II) is enforced here as a schema
 * refinement, not a convention: `verified` REQUIRES a reproduction and forbids a
 * confidence score; `research` REQUIRES a confidence score. Any producer or consumer
 * that parses through this schema cannot construct a mislabeled finding.
 */

export const TIERS = ["verified", "research"] as const;
export type Tier = (typeof TIERS)[number];

export const SURFACES = ["app_code", "agent_code", "mcp_server", "tool_defs", "permission_scopes"] as const;
export type Surface = (typeof SURFACES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const locationSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  surface: z.enum(SURFACES),
});
export type Location = z.infer<typeof locationSchema>;

export const reproductionSchema = z.object({
  kind: z.enum(["command", "http", "inspection"]),
  steps: z.array(z.string().min(1)).min(1),
  expected: z.string().min(1),
});
export type Reproduction = z.infer<typeof reproductionSchema>;

/**
 * The operations a suggested fix may describe. Deliberately a one-member enum rather than a
 * bare flag: it names the semantics at the wire level and leaves room for a future
 * `"replace"` without a breaking schema change.
 *
 * `insert_after` — `insertedLines` is inserted immediately AFTER `endLine`. Nothing is
 * removed. This is the only operation Gatepass emits today, and it is chosen on purpose:
 * a replacement would have to carry a verbatim copy of the customer's own source in order
 * to be applied, and the findings document must never become a channel for source code
 * (contract rule 6 / runner-protocol guard). An insertion needs only generated text.
 */
export const FIX_OPERATIONS = ["insert_after"] as const;
export type FixOperation = (typeof FIX_OPERATIONS)[number];

/**
 * An applicable edit: an exact anchor range in one file plus the literal lines to add.
 * Consumers (PR suggestion builder, fix-PR opener, dashboard) can apply this mechanically;
 * nothing here is prose. Anything that cannot be expressed this way MUST ship as
 * `agent_guidance` instead — see `suggestedFixSchema`.
 */
export const fixEditSchema = z
  .object({
    path: z.string().min(1),
    /** 1-indexed, inclusive anchor range — the statement/expression the fix attaches to. */
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    operation: z.enum(FIX_OPERATIONS).default("insert_after"),
    /** Literal lines to insert. Generated text only — never a copy of customer source. */
    insertedLines: z.string().min(1),
  })
  .refine((e) => e.endLine >= e.startLine, {
    message: "fix edit endLine must be >= startLine",
    path: ["endLine"],
  });
export type FixEdit = z.infer<typeof fixEditSchema>;

/**
 * A suggested fix (FR-012). Advisory only — Gatepass never applies one without a human
 * asking for it, and never without review (Constitution Principle III).
 *
 * The two kinds are not interchangeable, and the schema enforces which is which:
 *
 * - `diff` MUST carry an `edit`. A `diff` is rendered as a GitHub ```suggestion``` block,
 *   which a reviewer applies with one click and no further reading — so a `diff` whose
 *   payload is prose, a comment, or a placeholder value would silently corrupt the file it
 *   claims to fix. `content` remains the human-readable rationale shown beside the edit.
 * - `agent_guidance` MUST NOT carry an `edit`. It is prose for a developer (or their own
 *   coding agent) to act on, used wherever a correct fix needs a value only a human can
 *   choose (an allow-listed origin, a pinned version, an RLS predicate) or is not an edit
 *   at all (rotating a leaked credential).
 */
export const suggestedFixSchema = z
  .object({
    kind: z.enum(["diff", "agent_guidance"]),
    content: z.string().min(1),
    edit: fixEditSchema.optional(),
  })
  .refine((f) => (f.kind === "diff") === (f.edit !== undefined), {
    message: 'suggestedFix kind "diff" requires an edit, and an edit requires kind "diff"',
    path: ["edit"],
  });
export type SuggestedFix = z.infer<typeof suggestedFixSchema>;

const findingBase = z.object({
  fingerprint: z.string().min(1),
  classId: z.string().min(1),
  severity: z.enum(SEVERITIES),
  surfaces: z.array(z.enum(SURFACES)).min(1),
  locations: z.array(locationSchema).min(1),
  explanation: z.string().min(1),
  suggestedFix: suggestedFixSchema.optional(),
});

/** Verified tier: reproduction REQUIRED, confidence FORBIDDEN. */
export const verifiedFindingSchema = findingBase.extend({
  tier: z.literal("verified"),
  reproduction: reproductionSchema,
  confidence: z.undefined().optional(),
});

/** Research tier: confidence REQUIRED (0..1), reproduction FORBIDDEN. */
export const researchFindingSchema = findingBase.extend({
  tier: z.literal("research"),
  confidence: z.number().min(0).max(1),
  reproduction: z.undefined().optional(),
});

export const findingSchema = z.discriminatedUnion("tier", [verifiedFindingSchema, researchFindingSchema]);
export type Finding = z.infer<typeof findingSchema>;

export const scanMetaSchema = z.object({
  id: z.string().min(1),
  rulesetVersion: z.string().min(1),
  executionMode: z.enum(["hosted", "runner", "cli"]),
  commitSha: z.string().optional(),
  surfacesScanned: z.array(z.enum(SURFACES)),
});

export const findingsDocumentSchema = z.object({
  schema: z.literal("gatepass.findings/1"),
  scan: scanMetaSchema,
  findings: z.array(findingSchema),
});
export type FindingsDocument = z.infer<typeof findingsDocumentSchema>;

/**
 * A finding is cross-surface (FR-002) only when its *locations* span two or more distinct
 * surfaces — i.e. detecting it required correlating evidence across surfaces. A single
 * location in a file that merely classifies into several surfaces is NOT cross-surface;
 * that would overclaim the correlation capability.
 */
export function isCrossSurface(finding: Finding): boolean {
  return new Set(finding.locations.map((l) => l.surface)).size >= 2;
}
