import type { ScanContext } from "@gatepass/engine";
import type { ComplianceCheck } from "../compliance-schema.js";
import { registerScanner, makeCheck } from "../compliance-scanner.js";
import type { DomainScanner } from "../compliance-scanner.js";
import { combineFiles, complianceRelevantFiles, resolveLocations, REPO_WIDE } from "../source-map.js";

/**
 * CCPA/CPRA compliance scanner.
 * Checks for Global Privacy Control (GPC) signal handling, Do Not Sell link presence,
 * DSAR deletion workflows, and privacy policy accessibility.
 *
 * Checks performed:
 * - ccpa-gpc-signal: Detects GPC signal handling code
 * - ccpa-well-known-gpc: Checks for /.well-known/gpc.json
 * - ccpa-do-not-sell-link: Detects "Do Not Sell" link/mechanism
 * - ccpa-dsar-workflow: Detects data deletion request handling
 * - ccpa-privacy-policy: Checks for privacy policy link
 */

const GPC_HEADER_RE = /Sec-GPC|globalPrivacyControl|navigator\.globalPrivacyControl/gi;
const GPC_WELL_KNOWN_RE = /\.well-known\/gpc\.json|gpc\.json/gi;
const DSAR_RE =
  /(data\s*(deletion|subject|access|request)|dsar|right\s*to\s*(delete|be\s*forgotten|access)|deletion.*(request|workflow)|\/delete.*account|account.*deletion)/gi;
const PRIVACY_POLICY_RE = /(privacy(\s*policy|\s*notice)?|privacy\.md|privacy\.html)/gi;

function checkGpcSignal(content: string, filePath: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const lines = content.split(/\n/);
  const gpcHits: { line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    GPC_HEADER_RE.lastIndex = 0;
    if (GPC_HEADER_RE.test(lines[i]!)) {
      gpcHits.push({ line: i + 1, text: lines[i]!.trim() });
    }
  }

  if (gpcHits.length > 0) {
    // GPC signal detected — check for opt-out propagation
    const hasOptOutAction = lines.some((l) =>
      /(opt.*out|stop.*track|block.*third.party|consent.*deny|do_not_sell|privacy.*opt)/gi.test(l),
    );
    if (hasOptOutAction) {
      checks.push(makeCheck("ccpa-gpc-signal", "pass", []));
    } else {
      checks.push(
        makeCheck(
          "ccpa-gpc-signal",
          "fail",
          gpcHits.slice(0, 3).map((h) => ({
            path: filePath,
            startLine: h.line,
            endLine: h.line,
            snippet: h.text,
          })),
          {
            kind: "code_change",
            description:
              "GPC signal is detected but not propagated to opt-out logic. The signal must result in actual suppression of data selling/sharing.",
            diff: "// Detect GPC and apply opt-out:\nif (navigator.globalPrivacyControl) {\n  // Block third-party tracking domains\n  disableTracking();\n  // Update CMP consent state\n  window.__uspapi('setUSPData', { optOut: 'Y' });\n  // Show confirmation (required from Jan 2026)\n  showOptOutConfirmation();\n}",
          },
        ),
      );
    }
  } else {
    // GPC not detected — suggest implementation
    checks.push(
      makeCheck("ccpa-gpc-signal", "fail", [], {
        kind: "code_change",
        description:
          "No Global Privacy Control (GPC) signal handling detected. CCPA/CPRA requires honoring GPC as a valid opt-out of sale/sharing. The signal arrives via Sec-GPC HTTP header and navigator.globalPrivacyControl.",
        diff: "// Add GPC detection to your app's entry point:\n// Server-side (middleware):\nif (request.headers.get('Sec-GPC') === '1') {\n  response.headers.set('Set-GPC', '1');\n  // Skip marketing/tracking scripts in HTML response\n}\n\n// Client-side:\nif (typeof navigator !== 'undefined' && navigator.globalPrivacyControl) {\n  window.__gpcEnabled = true;\n  // Block third-party tracking scripts\n  document.querySelectorAll('[data-tracking]').forEach(el => el.remove());\n}\n\n// Also create: /.well-known/gpc.json with {\"gpc\":true,\"lastUpdate\":\"2026-01-01\"}",
      }),
    );
  }

  return checks;
}

function checkWellKnownGpc(files: ScanContext["files"]): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const hasWellKnown = files.some(
    (f) => /\.well-known\/gpc\.json/.test(f.relPath) || f.relPath === ".well-known/gpc.json",
  );

  // Also check content for gpc.json references
  const contentMatch = files.some((f) => GPC_WELL_KNOWN_RE.test(f.content));

  if (hasWellKnown || contentMatch) {
    checks.push(makeCheck("ccpa-well-known-gpc", "pass", []));
  } else {
    checks.push(
      makeCheck("ccpa-well-known-gpc", "fail", [], {
        kind: "file_create",
        description: "Missing .well-known/gpc.json file. This file declares your site honors GPC signals.",
        filePath: "/.well-known/gpc.json",
        newContent: JSON.stringify({ gpc: true, lastUpdate: new Date().toISOString().split("T")[0] }, null, 2),
      }),
    );
  }

  return checks;
}

/**
 * A CCPA "Do Not Sell" control is a LINK/BUTTON, not a mention. The first implementation
 * flagged the bare token `ccpa` anywhere in the code — so the compliance scanner's own source
 * tripped it. We now require the phrase to appear inside an actual navigational control (an
 * anchor, button, Link, or an href to an opt-out route), which is what the law requires and
 * what removes the false positives.
 */
const DO_NOT_SELL_PHRASE = /do\s*not\s*(sell|share)|your\s*privacy\s*choices|opt.?out\s*of\s*s(ale|haring)/i;
const LINK_CONTEXT =
  /<a[\s>]|<button[\s>]|<Link[\s>]|href\s*=|to\s*=\s*["'{]|role=["']link["']|class(Name)?=[^>]*(btn|link|nav|footer)/i;
const OPT_OUT_HREF = /href\s*=\s*["'][^"']*(do-?not-?sell|opt-?out|privacy-?choices|ccpa)[^"']*["']/i;

function checkDoNotSellLink(content: string, filePath: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const lines = content.split(/\n/);
  const hits: { line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // A real control: the do-not-sell phrase within a link/button, OR an href to an opt-out route.
    const isControl = (DO_NOT_SELL_PHRASE.test(line) && LINK_CONTEXT.test(line)) || OPT_OUT_HREF.test(line);
    if (isControl) hits.push({ line: i + 1, text: line.trim() });
  }

  // Prominence: the control should sit in a footer/nav/banner region.
  const inFooter = hits.some((h) => {
    const contextStart = Math.max(0, h.line - 6);
    const contextEnd = Math.min(lines.length, h.line + 6);
    for (let j = contextStart; j < contextEnd; j++) {
      if (/(footer|bottom-?nav|site-?nav|banner|privacy-?choices)/i.test(lines[j]!)) return true;
    }
    return false;
  });

  if (hits.length > 0) {
    if (inFooter) {
      checks.push(makeCheck("ccpa-do-not-sell-link", "pass", []));
    } else {
      checks.push(
        makeCheck(
          "ccpa-do-not-sell-link",
          "fail",
          hits.slice(0, 3).map((h) => ({
            path: filePath,
            startLine: h.line,
            endLine: h.line,
            snippet: h.text,
          })),
          {
            kind: "code_change",
            description:
              '"Do Not Sell" link found but not in a prominent location (footer/nav). CCPA requires the link to be on the homepage and mobile app in a conspicuous location.',
            diff: '<!-- Add CCPA link to footer -->\n<footer>\n  <a href="/privacy#opt-out">Do Not Sell or Share My Personal Information</a>\n</footer>',
          },
        ),
      );
    }
  } else {
    checks.push(
      makeCheck("ccpa-do-not-sell-link", "fail", [], {
        kind: "code_change",
        description:
          "No 'Do Not Sell or Share My Personal Information' link detected. CCPA/CPRA requires this link on the homepage and in-app.",
        diff: '<!-- Add to footer or navigation -->\n<a href="/do-not-sell" class="text-sm">\n  Do Not Sell or Share My Personal Information\n</a>\n\n// Also create a /do-not-sell page that processes opt-out requests',
      }),
    );
  }

  return checks;
}

function checkDsarWorkflow(content: string, filePath: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const lines = content.split(/\n/);
  const hits: { line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    DSAR_RE.lastIndex = 0;
    if (DSAR_RE.test(lines[i]!)) {
      hits.push({ line: i + 1, text: lines[i]!.trim() });
    }
  }

  if (hits.length > 0) {
    // Multi-system fan-out: a real deletion workflow purges the primary store AND downstream
    // systems (cache, backups, third-party providers). The original regex only matched a few
    // exact phrasings and flagged legitimate implementations (cache.purge, notifyServiceProviders,
    // Promise.all batch deletion) as incomplete — a false positive.
    const hasFanOut = lines.some((l) =>
      /(fan.?out|delete.*cach|cach\w*\.(purge|del|clear|invalidate)|purge.*(backup|cache)|delete.*backup|(notify|delete|purge).*(service.?provider|third.?part|downstream|processor)|deleteMany|Promise\.all[\s\S]{0,80}(delete|purge|remov))/i.test(
        l,
      ),
    );
    if (hasFanOut) {
      checks.push(makeCheck("ccpa-dsar-workflow", "pass", []));
    } else {
      checks.push(
        makeCheck(
          "ccpa-dsar-workflow",
          "fail",
          hits.slice(0, 3).map((h) => ({
            path: filePath,
            startLine: h.line,
            endLine: h.line,
            snippet: h.text,
          })),
          {
            kind: "code_change",
            description:
              "DSAR deletion mechanism found but may not fan out deletion requests across all systems (databases, caches, backups, service providers).",
            diff: "// DSAR deletion with cross-system fan-out:\nasync function handleDeletionRequest(userId: string) {\n  await Promise.all([\n    db.deleteUser(userId),          // Primary DB\n    cache.purge(`user:${userId}`),  // Redis/Memcached\n    fs.rm(`backups/${userId}`, { recursive: true }), // Backups\n    notifyServiceProviders(userId),  // Third-party systems\n  ]);\n  logDeletionEvent({ userId, timestamp, systems: ['db', 'cache', 'backups', 'service_providers'] });\n}",
          },
        ),
      );
    }
  } else {
    checks.push(
      makeCheck("ccpa-dsar-workflow", "fail", [], {
        kind: "code_change",
        description:
          "No data deletion/subject access request (DSAR) workflow detected. CCPA/CPRA requires a mechanism for consumers to request deletion of their personal information.",
        diff: '// Create DSAR endpoint in your API:\n// POST /api/privacy/deletion-request\napp.post(\'/api/privacy/deletion-request\', async (req, res) => {\n  const { email } = req.body;\n  // Validate request, initiate deletion across all systems\n  await enqueueDeletionJob({ email, requestedAt: new Date() });\n  res.json({ status: \'processing\', estimatedCompletion: \'30 days\' });\n});\n\n// Frontend form:\n<form action="/privacy/delete-data">\n  <label>Email address for data deletion request</label>\n  <input type="email" name="email" required />\n  <button type="submit">Request Data Deletion</button>\n</form>',
      }),
    );
  }

  return checks;
}

function checkPrivacyPolicy(content: string, filePath: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const dirs = new Set(filePath.split("/").slice(0, -1));
  const isRootDoc = filePath === "privacy.md" || filePath === "privacy.html" || filePath === "PRIVACY.md";
  const hasPolicyLink = PRIVACY_POLICY_RE.test(content);
  const hasPolicyFile = isRootDoc || (dirs.has("public") && content.includes("privacy"));

  if (hasPolicyLink || hasPolicyFile) {
    checks.push(makeCheck("ccpa-privacy-policy", "pass", []));
  } else {
    checks.push(
      makeCheck("ccpa-privacy-policy", "fail", [], {
        kind: "file_create",
        description:
          "No privacy policy found. CCPA/CPRA requires a publicly accessible privacy policy disclosing data collection practices.",
        filePath: "/public/privacy.md",
        newContent: `# Privacy Policy\n\n**Last updated:** ${new Date().toISOString().split("T")[0]}\n\n## Information We Collect\n- Account information (email, name)\n- Usage data (pages visited, features used)\n- Device information (browser, OS)\n\n## How We Use Your Information\n- Service delivery and improvement\n- Communications\n- Analytics\n\n## Your Rights (CCPA/CPRA)\n- Right to Know: You can request what data we collect\n- Right to Delete: You can request deletion of your data\n- Right to Opt-Out: You can opt out of sale/sharing\n\n## Contact\nprivacy@yourdomain.com\n`,
      }),
    );
  }

  return checks;
}

const ccpaScanner: DomainScanner = {
  domain: "ccpa",
  scan(ctx: ScanContext): ComplianceCheck[] {
    const checks: ComplianceCheck[] = [];
    const src = combineFiles(complianceRelevantFiles(ctx.files));

    // These checks report hit lines into the combined buffer; resolveLocations() maps each
    // one back to its real file:line so every reported location is openable.
    checks.push(...resolveLocations(checkGpcSignal(src.content, REPO_WIDE), src));
    checks.push(...checkWellKnownGpc(ctx.files));
    checks.push(...resolveLocations(checkDoNotSellLink(src.content, REPO_WIDE), src));
    checks.push(...resolveLocations(checkDsarWorkflow(src.content, REPO_WIDE), src));
    checks.push(...resolveLocations(checkPrivacyPolicy(src.content, REPO_WIDE), src));

    return checks;
  },
};

registerScanner(ccpaScanner);
