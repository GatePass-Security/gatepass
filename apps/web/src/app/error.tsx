"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { PageError } from "@/components/ui/PageError";

/**
 * The outermost boundary that still gets to look like Gatepass.
 *
 * It catches what the segment boundaries cannot: a throw in the marketing page at `/`, in the
 * login page, or in `(app)/layout.tsx` itself — a layout's own failure bubbles *past* the
 * boundary inside it, so `(app)/error.tsx` never sees one. Without this file all three landed
 * on Next's default error screen.
 *
 * `reset` is offered rather than a reload because a transient render failure often clears on a
 * re-render, and re-rendering is cheaper than fetching the document again.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageError
      icon={<AlertTriangle size={19} aria-hidden="true" />}
      title="This page didn’t load"
      onRetry={reset}
      secondary={
        <Link
          href="/"
          className="text-[0.82rem] text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
        >
          Go to the home page
        </Link>
      }
      operator="A render or data-fetch threw before this page could be produced. The API and application logs for this request carry the stack; the digest below identifies it."
      technical={error.digest ? `digest ${error.digest}` : error.message || undefined}
    >
      <p>
        Something went wrong while Gatepass was putting this page together. It is a fault on our side, not something you
        did, and nothing you had entered elsewhere was affected.
      </p>
      <p>Trying again usually works — the failure is often a one-off.</p>
    </PageError>
  );
}
