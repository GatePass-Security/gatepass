"use client";

import { ErrorState, PageHeader } from "@/components/ui";

export default function FleetError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet"
        description="MCP servers registered to this org, their last recorded posture, and the scan behind it."
      />
      <ErrorState title="Could not load the fleet" message={error.message} onRetry={reset} />
    </div>
  );
}
