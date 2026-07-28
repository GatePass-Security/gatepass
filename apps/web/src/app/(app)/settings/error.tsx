"use client";

import { ErrorPanel, PageHeader } from "@/components/ui";

export default function SettingsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Organization analysis toggles and repository gate configuration." />
      <ErrorPanel error={error} context={{ action: "load settings" }} onRetry={reset} />
    </div>
  );
}
