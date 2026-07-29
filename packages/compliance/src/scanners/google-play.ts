import type { ScanContext } from "@gatepass/engine";
import type { ComplianceCheck } from "../compliance-schema.js";
import { registerScanner, makeCheck } from "../compliance-scanner.js";
import type { DomainScanner } from "../compliance-scanner.js";
import { combineFiles, complianceRelevantFiles, REPO_WIDE, type CombinedSource } from "../source-map.js";

/**
 * Google Play Store compliance scanner.
 * Checks for Data Safety form declarations, encryption-in-transit,
 * deletion URL, SDK data collection disclosure, and privacy policy consistency.
 *
 * Checks performed:
 * - play-data-safety-form: Scans for Data Safety declarations
 * - play-encrypted-in-transit: Checks for HTTPS usage across the codebase
 * - play-deletion-url: Checks for data deletion mechanism
 * - play-sdk-disclosure: Checks for SDK data collection declarations
 * - play-privacy-policy-consistency: Checks privacy policy covers data practices
 */

const DATA_SAFETY_RE = /data.?safety|data.?security|data.?collection.*declaration|google.*play.*data/gi;
const HTTP_ENDPOINT_RE = /http:\/\/[a-zA-Z0-9.-]+(?!\.local|\.localhost|\.test|\.dev)/gi;
const HTTPS_RE = /https:\/\//gi;
const DELETION_URL_RE =
  /(delet|account.*remov|right.*to.*delet|data.*remov|delete.*account|\/delete.*data|\/account.*delet)/gi;
const SDK_RE =
  /(firebase|admob|crashlytics|sentry|mixpanel|amplitude|appsflyer|branch|onesignal|revenuecat|facebook.*sdk|google.*analytics)/gi;

// Android permission ↔ data type mapping
const PERMISSION_DATA_MAP: Array<{ permission: RegExp; dataType: string }> = [
  { permission: /ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION/gi, dataType: "Location" },
  { permission: /RECORD_AUDIO/gi, dataType: "Audio" },
  { permission: /READ_CONTACTS/gi, dataType: "Contacts" },
  { permission: /READ_MEDIA_IMAGES|CAMERA/gi, dataType: "Photos" },
  { permission: /READ_CALENDAR/gi, dataType: "Calendar" },
  { permission: /BODY_SENSORS/gi, dataType: "Health & Fitness" },
  { permission: /READ_EXTERNAL_STORAGE/gi, dataType: "Files & Docs" },
  { permission: /INTERNET|ACCESS_NETWORK_STATE/gi, dataType: "App Info & Performance" },
];

function checkDataSafetyDeclarations(src: CombinedSource): ComplianceCheck[] {
  const content = src.content;
  // Check for Data Safety-related comments or configs
  const hasDataSafety = DATA_SAFETY_RE.test(content);

  // Check AndroidManifest permissions to map to data types
  const foundPermissions: string[] = [];
  for (const mapping of PERMISSION_DATA_MAP) {
    mapping.permission.lastIndex = 0;
    if (mapping.permission.test(content)) {
      foundPermissions.push(mapping.dataType);
    }
  }

  if (hasDataSafety && foundPermissions.length > 0) {
    return [
      makeCheck(
        "play-data-safety-form",
        "pass",
        foundPermissions.map((dt) => ({
          path: REPO_WIDE,
          snippet: `Data type '${dt}' has corresponding permission declared`,
        })),
      ),
    ];
  }

  if (foundPermissions.length > 0) {
    return [
      makeCheck(
        "play-data-safety-form",
        "fail",
        foundPermissions.map((dt) => ({
          path: REPO_WIDE,
          snippet: `Permission for '${dt}' found — must declare in Google Play Data Safety form`,
        })),
        {
          kind: "config_change",
          description: `Android permissions found (${foundPermissions.join(", ")}) that require corresponding Data Safety declarations in Google Play Console. These count as data collection even if your code doesn't directly use them — SDKs count too.`,
          diff: `// Cross-reference in Google Play Console → App content → Data safety:\n// ${foundPermissions.join("\n// - ")}}\n// Each must be declared with appropriate collection purpose\n// Also check: https://play.google.com/console/app-content/data-safety`,
        },
      ),
    ];
  }

  return [makeCheck("play-data-safety-form", "not_applicable", [])];
}

function checkEncryptionInTransit(src: CombinedSource): ComplianceCheck[] {
  const content = src.content;
  const lines = content.split(/\n/);
  const httpEndpoints: { line: number; url: string }[] = [];
  let httpsCount = 0;

  for (let i = 0; i < lines.length; i++) {
    HTTP_ENDPOINT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HTTP_ENDPOINT_RE.exec(lines[i]!)) !== null) {
      httpEndpoints.push({ line: i + 1, url: m[0] });
    }
    if (HTTPS_RE.test(lines[i]!)) {
      httpsCount++;
    }
  }

  if (httpEndpoints.length > 0) {
    return [
      makeCheck(
        "play-encrypted-in-transit",
        "fail",
        httpEndpoints.slice(0, 5).map((ep) => ({
          ...src.resolve(ep.line),
          snippet: `Plaintext HTTP endpoint: ${ep.url}`,
        })),
        {
          kind: "code_change",
          description: `Found ${httpEndpoints.length} plaintext HTTP endpoints. Google Play requires all data to be encrypted in transit (HTTPS/TLS) — including SDK network calls.`,
          diff: `// Replace HTTP endpoints with HTTPS:\n${httpEndpoints
            .slice(0, 3)
            .map((ep) => `// ${ep.url} → ${ep.url.replace("http://", "https://")}`)
            .join("\n")}\n\n// Also check SDK configurations for plaintext endpoints`,
        },
      ),
    ];
  }

  if (httpsCount > 0) {
    return [makeCheck("play-encrypted-in-transit", "pass", [])];
  }

  return [
    makeCheck("play-encrypted-in-transit", "manual_review", [], {
      kind: "code_change",
      description: "No network endpoints detected. If this app makes network calls, ensure they use HTTPS/TLS.",
    }),
  ];
}

function checkDeletionUrl(src: CombinedSource): ComplianceCheck[] {
  const content = src.content;
  const deletionHits: { line: number; text: string }[] = [];
  const lines = content.split(/\n/);

  for (let i = 0; i < lines.length; i++) {
    DELETION_URL_RE.lastIndex = 0;
    if (DELETION_URL_RE.test(lines[i]!)) {
      deletionHits.push({ line: i + 1, text: lines[i]!.trim() });
    }
  }

  if (deletionHits.length > 0) {
    return [
      makeCheck(
        "play-deletion-url",
        "pass",
        deletionHits.slice(0, 3).map((h) => ({
          ...src.resolve(h.line),
          snippet: h.text,
        })),
      ),
    ];
  }

  return [
    makeCheck("play-deletion-url", "fail", [], {
      kind: "code_change",
      description:
        "No data deletion mechanism found. Google Play requires a publicly accessible HTTPS URL where users can request data deletion, even after uninstalling the app.",
      diff: `// Create a deletion page accessible at /privacy/delete-data\napp.get('/privacy/delete-data', (req, res) => {\n  res.render('deletion-form', {\n    description: 'Request deletion of your personal data. ' +\n      'We will process your request within 30 days.',\n    emailRequired: true,\n    retentionInfo: 'Some data may be retained for legal compliance (up to 90 days).'\n  });\n});\n\n// Add to privacy policy and Google Play Console Data Safety form`,
    }),
  ];
}

function checkSdkDisclosures(src: CombinedSource): ComplianceCheck[] {
  const content = src.content;
  const foundSdks: Set<string> = new Set();
  SDK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SDK_RE.exec(content)) !== null) {
    foundSdks.add(m[0].toLowerCase());
  }

  if (foundSdks.size > 0) {
    return [
      makeCheck(
        "play-sdk-disclosure",
        "fail",
        [...foundSdks].map((sdk) => ({
          path: REPO_WIDE,
          snippet: `SDK '${sdk}' detected — must be declared in Data Safety form`,
        })),
        {
          kind: "config_change",
          description: `SDKs found (${[...foundSdks].join(", ")}). Each SDK's data collection must be declared in the Data Safety form. Android ID usage by any SDK must be disclosed under 'Device or other IDs'. Check each SDK's Data Safety mapping.`,
          diff: `// For each SDK, check published Data Safety mappings:\n// Firebase: https://firebase.google.com/docs/analytics/googleplay-data-safety\n// AdMob: https://support.google.com/admob/answer/13529569\n// Verify Android ID (Settings.Secure.ANDROID_ID) is not collected by any SDK`,
        },
      ),
    ];
  }

  return [makeCheck("play-sdk-disclosure", "pass", [])];
}

function checkPrivacyPolicyConsistency(src: CombinedSource): ComplianceCheck[] {
  const content = src.content;
  const privacyMentioned = /privacy|data.*collect|personal.*information|ccpa|gdpr|user.*data/i.test(content);
  const dataCollectionMentioned = /collect.*(data|information|personal)|data.*(collect|process|share|store)/i.test(
    content,
  );

  if (privacyMentioned && dataCollectionMentioned) {
    return [makeCheck("play-privacy-policy-consistency", "pass", [])];
  }

  // Whether the privacy policy matches the Play Console Data Safety declaration can only be
  // confirmed against the live listing, which is not in the repository. We therefore surface
  // this as manual_review with concrete guidance, never a fabricated fail.
  return [
    makeCheck("play-privacy-policy-consistency", "manual_review", [], {
      kind: "code_change",
      description:
        "Google reviewers cross-check the privacy policy against the Play Console Data Safety form. That listing is not in the repo, so verify manually that the policy covers every declared data type, purpose, third-party SDK, deletion URL, and encryption practice.",
      diff: "// Verify the privacy policy covers, matching the Data Safety form:\n// 1. Each data type collected (and by third-party SDKs)\n// 2. Purpose of collection\n// 3. Deletion mechanism URL\n// 4. Encryption-in-transit practices",
    }),
  ];
}

const googlePlayScanner: DomainScanner = {
  domain: "google_play",
  scan(ctx: ScanContext): ComplianceCheck[] {
    const checks: ComplianceCheck[] = [];
    const src = combineFiles(complianceRelevantFiles(ctx.files));

    checks.push(...checkDataSafetyDeclarations(src));
    checks.push(...checkEncryptionInTransit(src));
    checks.push(...checkDeletionUrl(src));
    checks.push(...checkSdkDisclosures(src));
    checks.push(...checkPrivacyPolicyConsistency(src));

    return checks;
  },
};

registerScanner(googlePlayScanner);
