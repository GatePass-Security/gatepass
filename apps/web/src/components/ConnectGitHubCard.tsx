"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { CheckCircle2, Github } from "lucide-react";
import { useSession } from "@/providers/SessionProvider";
import { Card, CardTitle } from "./ui";

/**
 * Connect a GitHub account to the session you are already signed in with.
 *
 * The point of the local password door is that somebody can look at Gatepass before deciding to
 * authorize an OAuth app against their personal GitHub account. This is the other half: when
 * they do decide, they connect it from inside the product rather than signing out and starting
 * over as a different identity.
 *
 * What linking changes is narrow, and the copy says so rather than implying more. The account
 * they are signed in as does not change. The organization they are looking at does not change.
 * What appears is the list of GitHub organizations they can reach — and inside each, only the
 * repositories GitHub says they may work on.
 *
 * Rendered only for a local session. For somebody who signed in through GitHub there is nothing
 * to connect, and a card offering it would be furniture.
 */
export function ConnectGitHubCard() {
  const session = useSession();
  const pathname = usePathname();
  const params = useSearchParams();

  if (!session.local) return null;

  const linked = params.get("linked");
  const linkError = params.get("linkError");
  const orgCount = session.orgs?.length ?? 0;

  return (
    <Card header={<CardTitle icon={<Github size={15} />}>GitHub account</CardTitle>}>
      {linked && (
        <p className="mb-4 flex items-center gap-2 rounded-[var(--radius-control)] border border-verified-line bg-verified-soft px-3 py-2 text-[0.8rem] text-verified">
          <CheckCircle2 size={14} aria-hidden="true" />
          Connected as @{linked}
          {orgCount > 0 &&
            ` — ${orgCount} ${orgCount === 1 ? "organization" : "organizations"} available in the switcher`}
        </p>
      )}
      {linkError && (
        <p className="mb-4 rounded-[var(--radius-control)] border border-critical-line bg-critical-soft px-3 py-2 text-[0.8rem] text-critical">
          {linkError === "unavailable"
            ? "This deployment has no GitHub OAuth credentials configured, so there is nothing to connect to."
            : "GitHub authorized the request but Gatepass could not complete the connection. Trying again is safe."}
        </p>
      )}

      <p className="text-[0.82rem] leading-relaxed text-fg-secondary">
        You are signed in as <span className="font-medium text-fg">{session.login}</span>, a local account on this
        deployment. Connecting GitHub does not change who you are signed in as or which organization you are looking at
        — it adds the GitHub organizations your account can reach, and inside each one, the repositories GitHub says you
        may work on.
      </p>

      {session.orgs && session.orgs.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {session.orgs.map((org) => (
            <li key={org.id} className="flex items-center justify-between gap-3 text-[0.8rem]">
              <span className="truncate font-mono text-fg">{org.id}</span>
              <span className="shrink-0 text-fg-muted">
                {org.role} · {org.repoCount} {org.repoCount === 1 ? "repository" : "repositories"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <a
        href={`/api/auth/github/start?mode=link&next=${encodeURIComponent(pathname)}`}
        className="mt-5 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full bg-action px-5 text-[0.84rem] font-medium text-action-text transition-colors duration-150 hover:bg-action-hover"
      >
        <Github size={15} aria-hidden="true" />
        {orgCount > 0 ? "Reconnect GitHub" : "Connect GitHub"}
      </a>
    </Card>
  );
}
