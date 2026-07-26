/**
 * OWASP Top 10 for Agentic Applications (ASI, 2026) mapping.
 *
 * Published 2025-12-09 by the OWASP GenAI Security Project. Every Gatepass vulnerability class
 * maps to the ASI category it evidences, so findings, the dashboard, and the public benchmark
 * all speak the standard security teams are adopting.
 *
 * Honesty note carried into the product: roughly half the ASI list describes RUNTIME agent
 * behaviour (cascading failures, rogue agents, memory poisoning at inference time) that cannot
 * be established by static pre-deployment analysis. We therefore declare, per category, whether
 * Gatepass provides `full` static coverage, `partial` coverage (a static precondition of the
 * risk), or `none` (runtime-only). Claiming static coverage of a runtime-only category would be
 * exactly the kind of overclaim this product exists to avoid.
 */

export const ASI_IDS = [
  "ASI01",
  "ASI02",
  "ASI03",
  "ASI04",
  "ASI05",
  "ASI06",
  "ASI07",
  "ASI08",
  "ASI09",
  "ASI10",
] as const;
export type AsiId = (typeof ASI_IDS)[number];

export type AsiCoverage = "full" | "partial" | "none";

export interface AsiCategory {
  id: AsiId;
  title: string;
  /** What the risk is, in one line. */
  summary: string;
  /** Can this be established from source before deployment? */
  staticallyDetectable: boolean;
  coverage: AsiCoverage;
  /** Gatepass classes that evidence this category. */
  classIds: string[];
  /** Stated plainly when coverage is not `full`. */
  limitation?: string;
}

export const ASI_CATEGORIES: AsiCategory[] = [
  {
    id: "ASI01",
    title: "Agent Goal Hijack",
    summary:
      "An attacker redirects the agent's objective via injected instructions in ingested content or tool metadata.",
    staticallyDetectable: true,
    coverage: "full",
    classIds: ["tool-poisoning", "hbv"],
    limitation:
      "Covers injection planted in tool definitions/descriptions shipped with the code. Hijack via content fetched at runtime is a runtime control.",
  },
  {
    id: "ASI02",
    title: "Tool Misuse & Exploitation",
    summary: "A legitimate tool is invoked in an unsafe or unintended way, or exposed without constraints.",
    staticallyDetectable: true,
    coverage: "full",
    classIds: ["unbounded-tool-param", "missing-schema-validation", "unauth-mcp-transport"],
  },
  {
    id: "ASI03",
    title: "Agent Identity & Privilege Abuse",
    summary: "An agent borrows or escalates authority beyond the task it is performing.",
    staticallyDetectable: true,
    coverage: "full",
    classIds: ["confused-deputy", "cross-surface-scope-mismatch", "rls-gap"],
  },
  {
    id: "ASI04",
    title: "Agentic Supply Chain Compromise",
    summary: "Untrusted or unreviewed code, models, or credentials enter the agent's build.",
    staticallyDetectable: true,
    coverage: "full",
    classIds: ["unpinned-dependency", "exposed-secret"],
  },
  {
    id: "ASI05",
    title: "Unexpected Code Execution",
    summary: "Agent-controlled input reaches an execution or interpretation sink.",
    staticallyDetectable: true,
    coverage: "partial",
    classIds: ["missing-schema-validation", "unbounded-tool-param"],
    limitation:
      "Gatepass detects unvalidated/unbounded input reaching tool handlers (the precondition). It does not yet trace a full taint path to an exec/eval sink.",
  },
  {
    id: "ASI06",
    title: "Memory & Context Poisoning",
    summary: "Malicious data written into agent memory (e.g. a vector store) corrupts later decisions.",
    staticallyDetectable: true,
    coverage: "none",
    classIds: [],
    limitation:
      "Not yet covered. A static precondition exists (memory writes with no validation or segmentation) and is the highest-priority gap on the roadmap.",
  },
  {
    id: "ASI07",
    title: "Insecure Inter-Agent Communication",
    summary: "Agent-to-agent messages are unauthenticated or blindly trusted across a privilege boundary.",
    staticallyDetectable: true,
    coverage: "partial",
    classIds: ["confused-deputy", "unauth-mcp-transport"],
    limitation:
      "Covers unauthenticated transport and credential forwarding between services. Does not model multi-agent topology or trust chains.",
  },
  {
    id: "ASI08",
    title: "Cascading Agent Failures",
    summary: "One agent's failure propagates unchecked through a chain of dependent agents.",
    staticallyDetectable: false,
    coverage: "partial",
    classIds: ["over-permissioned-loop"],
    limitation:
      "Largely a runtime property. Gatepass detects the static precondition of an unbounded/uncapped agent loop.",
  },
  {
    id: "ASI09",
    title: "Human-Agent Trust Exploitation",
    summary: "The agent's presentation misleads a human into approving an unsafe action.",
    staticallyDetectable: true,
    coverage: "partial",
    classIds: ["hbv"],
    limitation:
      "Covers tool descriptions that understate or hide their real effect. Does not evaluate runtime UI/approval flows.",
  },
  {
    id: "ASI10",
    title: "Rogue Agents",
    summary: "An agent operates outside its intended scope or supervision.",
    staticallyDetectable: false,
    coverage: "partial",
    classIds: ["over-permissioned-loop", "cross-surface-scope-mismatch"],
    limitation:
      "Detection of a rogue agent is a runtime/monitoring problem. Gatepass detects the static enablers: unbounded loops and scope mismatches.",
  },
];

const CLASS_TO_ASI = new Map<string, AsiId[]>();
for (const cat of ASI_CATEGORIES) {
  for (const classId of cat.classIds) {
    const existing = CLASS_TO_ASI.get(classId) ?? [];
    existing.push(cat.id);
    CLASS_TO_ASI.set(classId, existing);
  }
}

/** ASI categories evidenced by a Gatepass vulnerability class (may be more than one). */
export function asiForClass(classId: string): AsiId[] {
  return CLASS_TO_ASI.get(classId) ?? [];
}

export function asiCategory(id: AsiId): AsiCategory | undefined {
  return ASI_CATEGORIES.find((c) => c.id === id);
}

/** Categories with at least one detector — the honest "we cover this statically" set. */
export function coveredAsiIds(): AsiId[] {
  return ASI_CATEGORIES.filter((c) => c.classIds.length > 0).map((c) => c.id);
}

export interface AsiCoverageSummary {
  full: AsiId[];
  partial: AsiId[];
  none: AsiId[];
  /** Categories that static analysis can address at all. */
  staticallyAddressable: AsiId[];
}

export function asiCoverageSummary(): AsiCoverageSummary {
  return {
    full: ASI_CATEGORIES.filter((c) => c.coverage === "full").map((c) => c.id),
    partial: ASI_CATEGORIES.filter((c) => c.coverage === "partial").map((c) => c.id),
    none: ASI_CATEGORIES.filter((c) => c.coverage === "none").map((c) => c.id),
    staticallyAddressable: ASI_CATEGORIES.filter((c) => c.staticallyDetectable).map((c) => c.id),
  };
}
