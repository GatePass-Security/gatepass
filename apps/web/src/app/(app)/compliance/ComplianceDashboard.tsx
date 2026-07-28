import { Suspense } from "react";
import ComplianceClient from "./ComplianceClient";
import { ComplianceSkeleton } from "./ComplianceSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorPanel } from "@/components/ui/EmptyState";
import { buildScanContext } from "@gatepass/engine";
import { runComplianceScan } from "@gatepass/compliance";
import type { ComplianceResult } from "@gatepass/compliance";

/**
 * Compliance dashboard — a server component that runs the compliance scanner
 * against the directory the dashboard process is running in and renders the
 * result. It deliberately does not go through the API: `POST
 * /v1/orgs/:org/compliance/scan` needs a `repoPath` on the API host, which the
 * browser has no way to supply.
 *
 * There is no fallback result. An earlier version synthesised a full
 * `ComplianceResult` when the scan threw — a fabricated score, a fabricated
 * per-domain breakdown (whose totals had drifted out of sync with the real rule
 * set), a `timestamp` of "now" implying a scan had just completed, every rule
 * marked `fail`, and a `fix.description` promising an autofix that does not
 * exist. It reached `ComplianceClient` through the same prop as a real result,
 * so nothing on screen distinguished the two. For a product whose claim is that
 * its output is checkable, a scan that failed has to say so.
 */

// Side-effect import: registers the compliance scanners via registerScanner.
import "@gatepass/compliance";

async function getComplianceResult(): Promise<{ result: ComplianceResult } | { error: string }> {
  try {
    const ctx = await buildScanContext(process.cwd());
    return { result: runComplianceScan(ctx, `compliance-scan-${Date.now()}`) };
  } catch (e) {
    console.error("Compliance scan failed:", e);
    // The message crosses the server/client boundary as a string because an
    // Error instance cannot be serialised. The client rebuilds one and hands it
    // to `ErrorPanel` — it is never rendered raw.
    return { error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function ComplianceDashboard() {
  const outcome = await getComplianceResult();

  if ("error" in outcome) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Compliance posture"
          description="Automated compliance scanning against WCAG 2.2, CCPA/CPRA, Apple App Store, Google Play, and EU AI Act (2026)."
        />
        {/* No score is shown because none was measured — see the note above. */}
        <ErrorPanel error={new Error(outcome.error)} context={{ action: "run the compliance scan" }} />
      </div>
    );
  }

  return (
    <Suspense fallback={<ComplianceSkeleton />}>
      <ComplianceClient result={outcome.result} />
    </Suspense>
  );
}
