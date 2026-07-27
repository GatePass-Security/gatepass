import { api } from "@/lib/api-client";
import { ORG_ID } from "@/lib/constants";

import type { Finding } from "@/lib/types";
import FindingsClient from "./FindingsClient";

// Re-fetch on every request (don't statically render at build time)
export const dynamic = "force-dynamic";

// This is a Server Component that fetches data
export default async function FindingsPage() {
  let findings: Finding[] = [];
  let scanId: string | undefined;
  let error: string | null = null;

  try {
    // Latest scan for the org drives the findings view (matches the dashboard overview).
    const scans = await api.listScans(ORG_ID);
    const latest = [...scans].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
    if (latest) {
      scanId = latest.id;
      findings = await api.getFindings(latest.id);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load findings";
  }

  return <FindingsClient findings={findings} scanId={scanId} error={error} />;
}
