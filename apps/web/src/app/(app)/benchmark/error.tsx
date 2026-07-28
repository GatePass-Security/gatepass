"use client";

import { ErrorPanel } from "@/components/ui/EmptyState";

export default function BenchmarkError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorPanel error={error} context={{ action: "load the benchmark" }} onRetry={reset} />;
}
