import { requireSession, serverApi } from "@/lib/session";

import type { Finding } from "@/lib/types";
import FindingsClient from "./FindingsClient";

// Re-fetch on every request (don't statically render at build time)
export const dynamic = "force-dynamic";

// This is a Server Component that fetches data
export default async function FindingsPage() {
  let findings: Finding[] = [];
  let scanId: string | undefined;
  let error: string | null = null;

  // Server Component: the org comes from the verified session and the API client carries this
  // request's session token, rather than both being the `"demo"` literal this file used to import.
  const { orgId } = await requireSession("/findings");
  const api = await serverApi();

  try {
    // Latest scan for the org drives the findings view (matches the dashboard overview).
    const scans = await api.listScans(orgId);
    const latest = [...scans].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
    if (latest) {
      scanId = latest.id;
      findings = await api.getFindings(latest.id);
    }
  } catch (e) {
    // The message crosses the server/client boundary as a string because an
    // Error instance cannot be serialised. The client rebuilds one and hands it
    // to `ErrorPanel` — it is never rendered raw.
    error = e instanceof Error ? e.message : "Failed to load findings";
  }

  return <FindingsClient findings={findings} scanId={scanId} error={error} />;
}
