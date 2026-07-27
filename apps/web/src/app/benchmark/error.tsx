"use client";

import { ErrorState } from "@/components/ui/EmptyState";

export default function BenchmarkError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorState title="Failed to load the benchmark" message={error.message} onRetry={reset} />;
}
