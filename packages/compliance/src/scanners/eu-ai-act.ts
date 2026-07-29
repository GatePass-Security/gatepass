import type { ScanContext } from "@gatepass/engine";
import type { ComplianceCheck } from "../compliance-schema.js";
import { registerScanner, makeCheck } from "../compliance-scanner.js";
import type { DomainScanner } from "../compliance-scanner.js";
import { combineFiles, complianceRelevantFiles, REPO_WIDE, type CombinedSource } from "../source-map.js";

/**
 * EU AI Act compliance scanner.
 * Checks for tamper-evident logging (Article 12), human oversight (Article 14),
 * risk management (Article 9), technical documentation (Article 11),
 * and accuracy/robustness (Article 15).
 *
 * Enforcement date: August 2, 2026 for Annex III high-risk systems.
 *
 * Checks performed:
 * - eu-ai-tamper-evident-logs: Detects HMAC/hash-chained logging
 * - eu-ai-human-oversight: Detects override/review/stop mechanisms
 * - eu-ai-risk-management: Checks for risk documentation
 * - eu-ai-technical-documentation: Checks for Annex IV docs
 * - eu-ai-accuracy-robustness: Checks for adversarial defense measures
 */

const HMAC_LOG_RE =
  /(hmac|sha256|sha-256|hash.?chain|tamper.?evident|append.?only|integrity.?hash|crypto.?log|audit.?log.*chain|merkle|trillian|rekor)/gi;
const LOG_RETENTION_RE = /(log.*retention|retain.*log|log.*store.*year|log.*persist|immutable.*log)/gi;
const OVERRIDE_RE =
  /(override|human.?in.?the.?loop|approv.*reject|confirm.*action|review.*gate|override.?button|stop.*button|emergency.*stop|halt|kill.*switch)/gi;
const EXPLAIN_RE =
  /(explainab|explain.*output|why.*recommend|reason.*behind|confidence.*score|model.*interpret|feature.*importance)/gi;
const THRESHOLD_RE = /(confidence.?threshold|score.*threshold|probability.*threshold|trigger.*review|flag.*review)/gi;
const ROLE_ACCESS_RE = /(role.?based|rbac|access.?control|permission.*review|cannot.*override.*without.*role)/gi;
const RISK_RE = /(risk.*(register|assessment|management|matrix)|risk.*mitigation|risk.*identif)/gi;
const ADVERSARIAL_RE =
  /(adversarial|prompt.?inject|model.?poison|red.?team|security.*test|robustness.*test|input.*sanitiz|output.*filter)/gi;
const MODEL_DOC_RE =
  /(model.*card|model.*doc|model.*version|training.*data|data.*sheet|dataset.*card|model.*metadata)/gi;

// Event types that EU AI Act Article 12 requires
const REQUIRED_LOG_EVENTS = [
  /inference.*call|model.*predict|inference.*log/gi,
  /model.*deploy|model.*rollback|model.*version.*change/gi,
  /threshold.*change|config.*change.*model/gi,
  /access.*log|log.*access|audit.*access/gi,
  /delet.*attempt|delet.*denied/gi,
];

function checkTamperEvidentLogs(src: CombinedSource): ComplianceCheck[] {
  const content = src.content;
  const lines = content.split(/\n/);
  const hmacHits: { line: number; text: string }[] = [];
  const retentionHits: { line: number; text: string }[] = [];
  const eventLogHits: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    HMAC_LOG_RE.lastIndex = 0;
    if (HMAC_LOG_RE.test(lines[i]!)) {
      hmacHits.push({ line: i + 1, text: lines[i]!.trim() });
    }
    LOG_RETENTION_RE.lastIndex = 0;
    if (LOG_RETENTION_RE.test(lines[i]!)) {
      retentionHits.push({ line: i + 1, text: lines[i]!.trim() });
    }
    // Check for required event types
    for (const eventRe of REQUIRED_LOG_EVENTS) {
      eventRe.lastIndex = 0;
      if (eventRe.test(lines[i]!)) {
        eventLogHits.push(eventRe.toString());
        break;
      }
    }
  }

  const hasHmacChain = hmacHits.length > 0;
  const hasRetention = retentionHits.length > 0;
  const hasEvents = eventLogHits.length >= 3;

  if (hasHmacChain && hasRetention && hasEvents) {
    return [
      makeCheck("eu-ai-tamper-evident-logs", "pass", [
        {
          path: REPO_WIDE,
          snippet: "HMAC-chained logging, retention policy, and required event types detected",
        },
      ]),
    ];
  }

  const missing: string[] = [];
  if (!hasHmacChain) missing.push("HMAC-SHA256 cryptographic chain");
  if (!hasRetention) missing.push("log retention policy (min 6 months per Art. 19)");
  if (!hasEvents)
    missing.push(
      `required event types (found ${eventLogHits.length}, need ≥3: inference, deployment, config changes, access)`,
    );

  const locations = [...hmacHits, ...retentionHits].slice(0, 5).map((h) => ({
    ...src.resolve(h.line),
    snippet: h.text,
  }));

  const fallbackLocation = {
    path: REPO_WIDE,
    snippet: `Missing: ${missing.join(", ")}`,
  };
  return [
    makeCheck("eu-ai-tamper-evident-logs", "fail", locations.length > 0 ? locations : [fallbackLocation], {
      kind: "code_change",
      description: `Article 12 compliance gap: ${missing.join("; ")}. High-risk AI systems must maintain tamper-evident audit logs with cryptographic chaining, automatic event recording, and minimum 6-month retention (Art. 19).`,
      diff: `// Implement tamper-evident audit logging (Article 12):
import { createHash, randomBytes } from 'node:crypto';

interface AuditEvent {
  id: string;
  timestamp: string;
  eventType: 'inference' | 'deployment' | 'threshold_change' | 'human_override' | 'access' | 'deletion_attempt';
  payload: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

function computeHash(event: Omit<AuditEvent, 'hash'>): string {
  return createHash('sha256')
    .update(JSON.stringify(event, Object.keys(event).sort()))
    .digest('hex');
}

class TamperEvidentLog {
  private store: AuditEvent[] = [];
  private lastHash = '0000000000000000000000000000000000000000000000000000000000000000';

  append(eventType: AuditEvent['eventType'], payload: Record<string, unknown>): AuditEvent {
    const event: Omit<AuditEvent, 'hash'> = {
      id: randomBytes(16).toString('hex'),
      timestamp: new Date().toISOString(),
      eventType,
      payload,
      previousHash: this.lastHash,
    };
    const hash = computeHash(event);
    const fullEvent = { ...event, hash };
    this.store.push(fullEvent);
    this.lastHash = hash;
    return fullEvent;
  }

  verifyChain(): boolean {
    let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    for (const event of this.store) {
      const { hash, ...rest } = event;
      if (computeHash(rest) !== hash) return false;
      if (rest.previousHash !== prevHash) return false;
      prevHash = hash;
    }
    return true;
  }
}

// Usage:
const auditLog = new TamperEvidentLog();
auditLog.append('inference', { modelId: 'v2.1', input: { /* feature vector */ }, output: { score: 0.95, decision: 'approved' } });`,
    }),
  ];
}

function checkHumanOversight(src: CombinedSource): ComplianceCheck[] {
  const content = src.content;
  const lines = content.split(/\n/);
  const overrideHits: { line: number; text: string }[] = [];
  const explainHits: { line: number; text: string }[] = [];
  const thresholdHits: { line: number; text: string }[] = [];
  const roleHits: { line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (OVERRIDE_RE.test(lines[i]!)) overrideHits.push({ line: i + 1, text: lines[i]!.trim() });
    if (EXPLAIN_RE.test(lines[i]!)) explainHits.push({ line: i + 1, text: lines[i]!.trim() });
    if (THRESHOLD_RE.test(lines[i]!)) thresholdHits.push({ line: i + 1, text: lines[i]!.trim() });
    if (ROLE_ACCESS_RE.test(lines[i]!)) roleHits.push({ line: i + 1, text: lines[i]!.trim() });
  }

  const hasOverride = overrideHits.length > 0;
  const hasExplain = explainHits.length > 0;
  const hasThreshold = thresholdHits.length > 0;
  const hasRoles = roleHits.length > 0;

  if (hasOverride && hasExplain && hasRoles) {
    return [
      makeCheck("eu-ai-human-oversight", "pass", [
        {
          path: REPO_WIDE,
          snippet: "Override, explainability, and access control mechanisms detected",
        },
      ]),
    ];
  }

  const missing: string[] = [];
  if (!hasOverride) missing.push("override/rejection mechanism (Article 14(4)(d-e))");
  if (!hasExplain) missing.push("interpretability/explainability surface (Article 14(4)(a-c))");
  if (!hasThreshold) missing.push("confidence threshold review triggers");
  if (!hasRoles) missing.push("role-based access control for oversight (Article 14(3))");

  const locations = [...overrideHits, ...explainHits, ...thresholdHits, ...roleHits].slice(0, 5).map((h) => ({
    ...src.resolve(h.line),
    snippet: h.text,
  }));

  const oversightFallback = {
    path: REPO_WIDE,
    snippet: `Missing: ${missing.join("; ")}`,
  };
  return [
    makeCheck("eu-ai-human-oversight", "fail", locations.length > 0 ? locations : [oversightFallback], {
      kind: "code_change",
      description: `Article 14 compliance gap: ${missing.join("; ")}. Human oversight must include: the ability to understand/override/stop the system, confidence thresholds that trigger review, and gating oversight to authorized personnel.`,
      diff: `// Implement human oversight (Article 14):

// 1. Override/rejection mechanism
async function getHumanReview(decision: AIDecision): Promise<HumanReview> {
  const review = await prisma.review.create({
    data: { decisionId: decision.id, status: 'pending', assignedRole: 'reviewer' }
  });
  // Wait for human decision with timeout
  return await prisma.review.findFirstOrThrow({
    where: { id: review.id, status: { not: 'pending' } },
    timeout: 86_400_000, // 24h max wait
  });
}

// 2. Confidence threshold triggers
const REVIEW_THRESHOLD = 0.85;
if (inference.confidence < REVIEW_THRESHOLD) {
  const review = await getHumanReview(inference);
  return review.action === 'override' ? review.decision : inference;
}

// 3. Emergency stop mechanism
let systemActive = true;
function emergencyStop(reason: string, userId: string) {
  systemActive = false;
  auditLog.append('emergency_stop', { reason, userId });
  // Gracefully drain active requests
}

// 4. Role-based access for oversight
// Use RBAC: only users with 'ai_reviewer' role can override
// only users with 'ai_admin' role can emergency-stop`,
    }),
  ];
}

function checkRiskManagement(src: CombinedSource): ComplianceCheck[] {
  const content = src.content;
  const hasRiskRegister = RISK_RE.test(content);

  if (hasRiskRegister) {
    return [makeCheck("eu-ai-risk-management", "pass", [])];
  }

  return [
    makeCheck("eu-ai-risk-management", "manual_review", [], {
      kind: "code_change",
      description:
        "Article 9 requires a continuous risk management process with a living risk register. This cannot be fully auto-detected. Maintain a risk register document covering: system design risks, identified hazards, mitigation strategies, and periodic review cycle.",
      diff: "// Create a risk register document (docs/risk-register.md):\n// ## AI System Risk Register\n// | Risk ID | Hazard | Likelihood | Severity | Mitigation | Review Date |\n// |---------|--------|-----------|----------|-----------|-------------|\n// | R-001 | Model hallucination | Medium | High | Human review at <85% confidence | 2026-08-15 |\n// | R-002 | Data bias | Low | High | Training data audit, fairness metrics | 2026-09-01 |",
    }),
  ];
}

function checkTechnicalDocumentation(src: CombinedSource): ComplianceCheck[] {
  const content = src.content;
  const hasModelDocs = MODEL_DOC_RE.test(content);

  if (hasModelDocs) {
    return [makeCheck("eu-ai-technical-documentation", "pass", [])];
  }

  return [
    makeCheck("eu-ai-technical-documentation", "manual_review", [], {
      kind: "code_change",
      description:
        "Article 11 / Annex IV requires comprehensive technical documentation. Maintain a model card and technical documentation covering: system design, development methodology, training data, performance metrics, and logging specifications.",
      diff: "// Create documentation structure:\n// docs/\n//   model-card.md (per Article 11 + Annex IV)\n//   technical-documentation.md\n//   training-data.md (Article 10)\n//   logging-spec.md (Article 12 reference)\n// Include: purpose, version, training data provenance, performance metrics, known limitations",
    }),
  ];
}

function checkAccuracyRobustness(src: CombinedSource): ComplianceCheck[] {
  const content = src.content;
  const hasAdversarialDefense = ADVERSARIAL_RE.test(content);

  if (hasAdversarialDefense) {
    return [
      makeCheck("eu-ai-accuracy-robustness", "pass", [
        {
          path: REPO_WIDE,
          snippet: "Adversarial defense measures detected",
        },
      ]),
    ];
  }

  return [
    makeCheck("eu-ai-accuracy-robustness", "fail", [], {
      kind: "code_change",
      description:
        "Article 15 requires measures against adversarial manipulation, model poisoning, and prompt injection. No such defenses detected.",
      diff: `// Implement Article 15 safeguards:

// 1. Input sanitization
function sanitizeInput(input: string): string {
  return input
    .replace(/<script[^>]*>.*?<\\/script>/gi, '')
    .replace(/<[^>]*on\\w+[^>]*>/gi, '')
    .trim();
}

// 2. Output filtering
function filterOutput(output: string): string {
  if (/[\\s\\S]*compare the system prompt/i.test(output)) {
    return '[[Response blocked: potential prompt injection detected]]';
  }
  return output;
}

// 3. Rate limiting and anomaly detection
const rateLimiter = new RateLimiter({ window: 60000, max: 100 });
if (!rateLimiter.check(userId)) {
  auditLog.append('rate_limit_exceeded', { userId });
  throw new Error('Rate limit exceeded');
}

// 4. Model version pinning
const MODEL_VERSION = '2026.07.15';
const ALLOWED_MODELS = new Set([MODEL_VERSION]);
if (!ALLOWED_MODELS.has(request.modelVersion)) {
  throw new Error('Untrusted model version');
}`,
    }),
  ];
}

const euAiActScanner: DomainScanner = {
  domain: "eu_ai_act",
  scan(ctx: ScanContext): ComplianceCheck[] {
    const checks: ComplianceCheck[] = [];
    const src = combineFiles(complianceRelevantFiles(ctx.files));

    checks.push(...checkTamperEvidentLogs(src));
    checks.push(...checkHumanOversight(src));
    checks.push(...checkRiskManagement(src));
    checks.push(...checkTechnicalDocumentation(src));
    checks.push(...checkAccuracyRobustness(src));

    return checks;
  },
};

registerScanner(euAiActScanner);
