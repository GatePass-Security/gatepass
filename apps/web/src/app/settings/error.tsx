"use client";

import { ErrorState, PageHeader } from "@/components/ui";

export default function SettingsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Organization analysis toggles and repository gate configuration." />
      <ErrorState title="Could not load settings" message={error.message} onRetry={reset} />
    </div>
  );
}
