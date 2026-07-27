"use client";

import { ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export default function FindingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Findings"
        description="Two-tier results from the latest scan. Verified findings carry a reproduction; research findings carry a confidence score."
      />
      <ErrorState
        title="Could not load findings"
        // `digest` is all the client gets for a server-side throw in production.
        message={error.message || `The findings request failed${error.digest ? ` (${error.digest})` : ""}.`}
        onRetry={reset}
      />
    </div>
  );
}
