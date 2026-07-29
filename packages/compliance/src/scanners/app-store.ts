import type { ScanContext } from "@gatepass/engine";
import type { ComplianceCheck } from "../compliance-schema.js";
import { registerScanner, makeCheck } from "../compliance-scanner.js";
import type { DomainScanner } from "../compliance-scanner.js";
import { combineFiles, complianceRelevantFiles, REPO_WIDE, type CombinedSource } from "../source-map.js";

/**
 * Apple App Store compliance scanner.
 * Checks for PrivacyInfo.xcprivacy manifest, Required Reason API declarations,
 * SDK privacy manifest presence, and privacy label consistency.
 *
 * Checks performed:
 * - apple-privacy-manifest: Scans for PrivacyInfo.xcprivacy files
 * - apple-required-reason-apis: Checks for Required Reason API usage without declarations
 * - apple-sdk-manifests: Checks if third-party SDKs include manifests
 * - apple-privacy-labels-match: Placeholder (requires App Store Connect check)
 */

const PRIVACY_MANIFEST_RE = /PrivacyInfo\.xcprivacy/gi;
const NS_PRIVACY_KEYS =
  /NSPrivacyTracking|NSPrivacyTrackingDomains|NSPrivacyCollectedDataTypes|NSPrivacyAccessedAPITypes/gi;

// Required Reason API categories (5 categories)
const REASON_API_CATEGORIES = [
  {
    pattern: /FileTimestamp|NSPrivacyAccessedAPICategoryFileTimestamp|creationDate|NSFileCreationDate/gi,
    name: "FileTimestamp",
  },
  {
    pattern: /SystemBootTime|NSPrivacyAccessedAPICategorySystemBootTime|systemUptime|mach_absolute_time/gi,
    name: "SystemBootTime",
  },
  { pattern: /DiskSpace|NSPrivacyAccessedAPICategoryDiskSpace|volumeAvailableCapacityKey/gi, name: "DiskSpace" },
  {
    pattern: /ActiveKeyboards|NSPrivacyAccessedAPICategoryActiveKeyboards|activeInputModes/gi,
    name: "ActiveKeyboards",
  },
  {
    pattern: /UserDefaults|NSPrivacyAccessedAPICategoryUserDefaults|@AppStorage|NSUserDefaults/gi,
    name: "UserDefaults",
  },
];

// Known SDKs that Apple requires to have their own manifest
const KNOWN_SDKS = [
  /firebase|crashlytics|google.*mobile.*ads|facebook.*sdk|adjust|appsflyer|branch\.io|onesignal|stripe|revenuecat/gi,
];

function checkPrivacyManifest(files: ScanContext["files"]): ComplianceCheck[] {
  const manifestFiles = files.filter((f) => PRIVACY_MANIFEST_RE.test(f.relPath));

  if (manifestFiles.length > 0) {
    // Check manifest contents for required keys
    for (const mf of manifestFiles) {
      if (NS_PRIVACY_KEYS.test(mf.content)) {
        return [
          makeCheck("apple-privacy-manifest", "pass", [
            {
              path: mf.relPath,
              snippet: "PrivacyInfo.xcprivacy found with required NSPrivacy keys",
            },
          ]),
        ];
      }
    }
    const firstManifest = manifestFiles[0]!;
    // Manifest exists but minimal
    return [
      makeCheck(
        "apple-privacy-manifest",
        "fail",
        manifestFiles.map((f) => ({
          path: f.relPath,
          snippet: `Missing required NSPrivacy* keys in ${f.relPath}`,
        })),
        {
          kind: "config_change",
          description:
            "PrivacyInfo.xcprivacy found but missing required keys. Must include NSPrivacyTracking, NSPrivacyTrackingDomains, NSPrivacyCollectedDataTypes, and NSPrivacyAccessedAPITypes.",
          filePath: firstManifest.relPath,
          diff: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyTracking</key>
  <false/>
  <key>NSPrivacyTrackingDomains</key>
  <array/>
  <key>NSPrivacyCollectedDataTypes</key>
  <array/>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>CA92.1</string>
      </array>
    </dict>
  </array>
</dict>
</plist>`,
        },
      ),
    ];
  }

  // No manifest found
  return [
    makeCheck("apple-privacy-manifest", "fail", [], {
      kind: "file_create",
      description:
        "No PrivacyInfo.xcprivacy found. Apple requires this file in every app bundle for App Store submission since May 2024. Missing manifest triggers ITMS-91053 rejection.",
      filePath: "/ios/PrivacyInfo.xcprivacy",
      newContent: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyTracking</key>
  <false/>
  <key>NSPrivacyTrackingDomains</key>
  <array/>
  <key>NSPrivacyCollectedDataTypes</key>
  <array/>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>CA92.1</string>
      </array>
    </dict>
  </array>
</dict>
</plist>`,
    }),
  ];
}

function checkRequiredReasonApis(src: CombinedSource): ComplianceCheck[] {
  const content = src.content;
  const foundApis: { api: string; line: number }[] = [];
  const lines = content.split(/\n/);

  for (const cat of REASON_API_CATEGORIES) {
    for (let i = 0; i < lines.length; i++) {
      cat.pattern.lastIndex = 0;
      if (cat.pattern.test(lines[i]!)) {
        foundApis.push({ api: cat.name, line: i + 1 });
      }
    }
  }

  if (foundApis.length > 0) {
    return [
      makeCheck(
        "apple-required-reason-apis",
        "fail",
        foundApis.slice(0, 5).map((a) => ({
          ...src.resolve(a.line),
          snippet: `Required Reason API '${a.api}' used at line ${a.line} — must be declared in PrivacyInfo.xcprivacy`,
        })),
        {
          kind: "config_change",
          description: `Found ${foundApis.length} Required Reason API usages without manifest declarations. Every use of FileTimestamp, SystemBootTime, DiskSpace, ActiveKeyboards, or UserDefaults must be declared with an Apple-approved reason code.`,
          diff: `// Add to PrivacyInfo.xcprivacy's NSPrivacyAccessedAPITypes for each used category:
<key>NSPrivacyAccessedAPIType</key>
<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
<key>NSPrivacyAccessedAPITypeReasons</key>
<array><string>CA92.1</string></array>`,
        },
      ),
    ];
  }

  return [makeCheck("apple-required-reason-apis", "pass", [])];
}

function checkSdkManifests(src: CombinedSource): ComplianceCheck[] {
  const content = src.content;
  const foundSdks: string[] = [];

  for (const sdkRe of KNOWN_SDKS) {
    sdkRe.lastIndex = 0;
    const match = sdkRe.exec(content);
    if (match) {
      foundSdks.push(match[0]);
    }
  }

  if (foundSdks.length > 0) {
    return [
      makeCheck(
        "apple-sdk-manifests",
        "fail",
        foundSdks.slice(0, 5).map((sdk) => ({
          path: REPO_WIDE,
          snippet: `SDK referenced: ${sdk} — must ship its own PrivacyInfo.xcprivacy`,
        })),
        {
          kind: "config_change",
          description: `Third-party SDKs detected (${foundSdks.slice(0, 3).join(", ")}) that must include their own PrivacyInfo.xcprivacy. Update to versions that ship privacy manifests. For Apple's listed SDKs, binary signatures are also required.`,
          diff: "// For each SDK, check: npm show <package> version \n// Verify the SDK version includes PrivacyInfo.xcprivacy\n// Update to latest versions that ship privacy manifests\n// For unmaintained SDKs, consider replacing them",
        },
      ),
    ];
  }

  return [makeCheck("apple-sdk-manifests", "pass", [])];
}

function checkPrivacyLabels(): ComplianceCheck[] {
  // This is a manual-review check — we cannot verify App Store Connect labels from source code
  return [
    makeCheck("apple-privacy-labels-match", "manual_review", [], {
      kind: "config_change",
      description:
        "Verify that App Store Connect privacy nutrition labels match the PrivacyInfo.xcprivacy manifest declarations. Any mismatch (e.g., label says 'No Data Collected' but manifest declares UserDefaults usage) is a 5.1.1 rejection.",
      diff: "// Cross-check required:\n// 1. Export privacy report from Xcode Archive → Generate Privacy Report\n// 2. Compare each NSPrivacyCollectedDataTypes entry against App Store Connect labels\n// 3. Ensure privacy policy URL in App Store Connect matches hosted policy\n// 4. Check SDK manifests match aggregate app declaration",
    }),
  ];
}

const appStoreScanner: DomainScanner = {
  domain: "app_store",
  scan(ctx: ScanContext): ComplianceCheck[] {
    const checks: ComplianceCheck[] = [];
    const src = combineFiles(complianceRelevantFiles(ctx.files));

    checks.push(...checkPrivacyManifest(ctx.files));
    checks.push(...checkRequiredReasonApis(src));
    checks.push(...checkSdkManifests(src));
    checks.push(...checkPrivacyLabels());

    return checks;
  },
};

registerScanner(appStoreScanner);
