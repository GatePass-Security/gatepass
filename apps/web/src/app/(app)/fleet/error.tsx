"use client";

import { ErrorPanel, PageHeader } from "@/components/ui";

export default function FleetError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet"
        description="MCP servers registered to this org, their last recorded posture, and the scan behind it."
      />
      <ErrorPanel error={error} context={{ action: "load the fleet" }} onRetry={reset} />
    </div>
  );
}
