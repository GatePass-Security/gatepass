import { requireSession, serverApi } from "@/lib/session";

import type { AttributedFinding } from "@/lib/types";
import FindingsClient from "./FindingsClient";

// Re-fetch on every request (don't statically render at build time)
export const dynamic = "force-dynamic";

// This is a Server Component that fetches data
export default async function FindingsPage() {
  let findings: AttributedFinding[] = [];
  let repoCount = 0;
  let error: string | null = null;

  // Server Component: the org comes from the verified session and the API client carries this
  // request's session token, rather than both being the `"demo"` literal this file used to import.
  const { orgId } = await requireSession("/findings");
  const api = await serverApi();

  try {
    /*
     * The org's current findings, across every repository it has connected.
     *
     * This page used to load the scan history, take the newest scan and show only its
     * findings. That is the right answer for an org with one repository and badly wrong for
     * an org with several: the page reported whatever the most recently scanned repository
     * said, so a clean scan landing last rendered an empty findings page for a deployment
     * holding findings in every other repository. `GET /v1/orgs/:org/findings` answers the
     * question the page is actually asking, in one round trip, and tags each finding with the
     * repository and scan it came from.
     */
    const current = await api.listOrgFindings(orgId);
    findings = current.findings;
    repoCount = new Set(current.scans.map((s) => s.repo).filter(Boolean)).size;
  } catch (e) {
    // The message crosses the server/client boundary as a string because an
    // Error instance cannot be serialised. The client rebuilds one and hands it
    // to `ErrorPanel` — it is never rendered raw.
    error = e instanceof Error ? e.message : "Failed to load findings";
  }

  return <FindingsClient findings={findings} repoCount={repoCount} error={error} />;
}
