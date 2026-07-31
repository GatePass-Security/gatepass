"use client";

import { ErrorPanel } from "@/components/ui";

/**
 * The catch-all boundary for the authenticated product.
 *
 * Five routes had their own `error.tsx` and the rest — overview, scans, repos, evidence, proof,
 * system, docs, support, agent guidance — had none, so a server-side throw on any of them
 * escaped the product entirely and landed on Next's default screen: an unstyled
 * "Application error: a server-side exception has occurred" with a digest hash and no way back.
 * That page cannot say what failed, cannot offer a retry, and does not look like Gatepass.
 *
 * A boundary here means every route inside the shell degrades to the same explained panel,
 * inside the sidebar and top bar, with the session intact. The per-route files still win where
 * they exist — they can name the thing that failed ("load findings") — and this only catches
 * what would otherwise have caught nothing.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  /*
   * In production a server-side throw reaches the client as an empty message plus a digest —
   * React strips the text deliberately, so it cannot leak. An empty message would render as
   * "No further detail was returned", which reads like the error was inspected and found to be
   * nothing. The digest is the only handle support has, so it is put where it can be read and
   * quoted rather than dropped.
   */
  const shown = error.message
    ? error
    : new Error(`Gatepass could not finish rendering this page${error.digest ? ` (${error.digest})` : ""}.`);

  return <ErrorPanel error={shown} context={{ action: "load this page" }} onRetry={reset} />;
}
