import { createHash } from "node:crypto";
import type { Detector, DetectorFinding, ScanContext } from "@gatepass/engine";
import {
  parseFinding,
  assertRedacted,
  assertFixRedacted,
  type Finding,
  type FindingsDocument,
} from "@gatepass/findings";
import { generateSuggestedFix, fixSourceFrom } from "./fixes.js";
import { LlmGateway, analyzeSemantic } from "@gatepass/semantic";
import { exposedSecretDetector } from "./exposed-secret.js";
import { unauthMcpTransportDetector } from "./unauth-mcp-transport.js";
import { toolPoisoningDetector } from "./tool-poisoning.js";
import { rlsGapDetector } from "./rls-gap.js";
import { corsDetector } from "./cors.js";
import { dependenciesDetector } from "./dependencies.js";
import { unboundedToolParamDetector, missingSchemaValidationDetector } from "./tool-params.js";
import { crossSurfaceScopeDetector } from "./cross-surface.js";
import { hbvDetector } from "./hbv.js";
import { confusedDeputyDetector } from "./confused-deputy.js";
import { overPermissionedLoopDetector } from "./over-permissioned-loop.js";

/** The default (active) ruleset. */
export const DEFAULT_DETECTORS: Detector[] = [
  // verified tier
  exposedSecretDetector,
  unauthMcpTransportDetector,
  rlsGapDetector,
  corsDetector,
  dependenciesDetector,
  unboundedToolParamDetector,
  missingSchemaValidationDetector,
  // research tier
  toolPoisoningDetector,
  crossSurfaceScopeDetector,
  hbvDetector,
  confusedDeputyDetector,
  overPermissionedLoopDetector,
];

function fingerprint(f: DetectorFinding): string {
  const loc = f.locations[0]!;
  const key = `${f.classId}|${loc.path}|${loc.startLine}|${f.tier}`;
  return "sha256:" + createHash("sha256").update(key).digest("hex").slice(0, 24);
}

export interface RunScanOptions {
  scanId: string;
  rulesetVersion: string;
  executionMode: "hosted" | "runner" | "cli";
  commitSha?: string;
  detectors?: Detector[];
  /** When false, research-tier detectors are skipped (LLM disabled — FR-011a). */
  semanticEnabled?: boolean;
  /**
   * When false, findings carry no `suggestedFix`. Fix generation is a pure function of the
   * finding and the scanned source, so this exists for callers that only want the detection
   * result (the corpus harness measures detection, not remediation) — not as a safety valve.
   */
  suggestFixes?: boolean;
}

/**
 * Run the scan pipeline over a context. Every emitted finding is:
 *  - assigned a stable fingerprint,
 *  - redaction-checked (verified tier),
 *  - given its suggested fix, derived from the source the finding points at (FR-012),
 *  - validated through the canonical schema (tier integrity enforced or it throws).
 * Output is deterministic for a given (ruleset, context) — the basis of hosted/runner
 * parity (FR-006a). Fix generation is pure over (finding, source), so it does not weaken
 * that: the same inputs still produce a byte-identical document.
 */
export function runScan(ctx: ScanContext, opts: RunScanOptions): FindingsDocument {
  const detectors = (opts.detectors ?? DEFAULT_DETECTORS).filter(
    (d) => opts.semanticEnabled !== false || d.tier !== "research",
  );

  const findings: Finding[] = [];
  const seen = new Set<string>();
  // Fixes are generated from the same in-memory files the detectors read — the scan never
  // goes back to disk, and no source outlives the context.
  const source = fixSourceFrom(new Map(ctx.files.map((f) => [f.relPath, f.content])));

  for (const detector of detectors) {
    for (const raw of detector.run(ctx)) {
      const fp = fingerprint(raw);
      if (seen.has(fp)) continue;
      seen.add(fp);

      if (raw.tier === "verified" && raw.reproduction && raw.rawSecrets?.length) {
        assertRedacted(raw.reproduction, raw.rawSecrets);
      }
      const { rawSecrets: _rawSecrets, ...findingData } = raw;
      // Parse first so fix generation only ever sees a schema-valid finding, then parse
      // again with the fix attached so the fix itself is validated (a `diff` without an
      // applicable edit cannot enter the document).
      const parsed = parseFinding({ ...findingData, fingerprint: fp });
      const fix = opts.suggestFixes === false ? undefined : generateSuggestedFix(parsed, source);
      if (fix && raw.rawSecrets?.length) assertFixRedacted(fix, raw.rawSecrets);
      findings.push(fix ? parseFinding({ ...parsed, suggestedFix: fix }) : parsed);
    }
  }

  findings.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));

  return {
    schema: "gatepass.findings/1",
    scan: {
      id: opts.scanId,
      rulesetVersion: opts.rulesetVersion,
      executionMode: opts.executionMode,
      commitSha: opts.commitSha,
      surfacesScanned: ctx.surfacesPresent,
    },
    findings,
  };
}

const ARTIFACT_MAX = 4000;

/**
 * Async scan that refines research-tier confidence with the LLM gateway in-line (FR-011a).
 * Runs the deterministic `runScan` first, then, when a gateway is enabled, sends each
 * research finding's extracted artifact (a bounded slice of its file — never the whole repo)
 * to the model and blends the returned confidence. Verified findings are untouched, so tier
 * integrity and hosted/runner determinism of the verified set are preserved. When no gateway
 * is enabled this is identical to `runScan`.
 */
export async function runScanAsync(
  ctx: ScanContext,
  opts: RunScanOptions,
  gateway?: LlmGateway,
): Promise<FindingsDocument> {
  const doc = runScan(ctx, opts);
  if (!gateway || !gateway.enabled || opts.semanticEnabled === false) return doc;

  const contentByPath = new Map(ctx.files.map((f) => [f.relPath, f.content]));
  const findings = await Promise.all(
    doc.findings.map(async (f): Promise<Finding> => {
      if (f.tier !== "research") return f;
      const loc = f.locations[0]!;
      const artifact = (contentByPath.get(loc.path) ?? "").slice(0, ARTIFACT_MAX);
      // Refinement is best-effort: an LLM outage (rate limit, timeout) must never fail the
      // scan — the finding keeps its heuristic confidence, same as running without a gateway.
      try {
        const result = await analyzeSemantic(
          { classId: f.classId, artifact, heuristicConfidence: f.confidence },
          gateway,
        );
        // Re-validate through the schema so a refined finding cannot violate tier integrity.
        return parseFinding({ ...f, confidence: result.confidence });
      } catch {
        return f;
      }
    }),
  );
  findings.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  return { ...doc, findings };
}
