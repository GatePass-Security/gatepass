"use client";

import { ErrorPanel } from "@/components/ui/EmptyState";

export default function ComplianceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} context={{ action: "run the compliance scan" }} onRetry={reset} />;
}
