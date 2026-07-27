"use client";

import { ErrorState } from "@/components/ui/EmptyState";

export default function ComplianceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="Compliance scan could not run"
      message={error.message || "The compliance scanner did not return a result for this workspace."}
      onRetry={reset}
    />
  );
}
