"use client";

import { usePathname } from "next/navigation";
import { Building2, Check, ChevronDown } from "lucide-react";
import { useSession } from "@/providers/SessionProvider";
import { cx } from "@/lib/utils";

/**
 * Which organization you are looking at, and the way to another one.
 *
 * The list is every GitHub organization the signed-in account can reach — resolved from
 * GitHub's own answer, not from anything the browser sent. Switching is a `POST` form rather
 * than a link for the same reason sign-out is: a GET that changes which tenant's security
 * findings you are looking at can be fired by an image tag on any page, and quietly
 * re-pointing somebody at a different organization is not something a third party should be
 * able to do to them.
 *
 * The whole control is absent when there is only one org to be in. A switcher offering the
 * choice you are already making is furniture, and this bar has enough of it.
 *
 * `native <details>` rather than a hand-rolled menu: it opens with the keyboard, closes on
 * Escape, and is announced correctly, all without a single line of state — and a dropdown that
 * is subtly wrong for keyboard users is a worse outcome than a plain one.
 */
export function OrgSwitcher() {
  const session = useSession();
  const pathname = usePathname();
  const orgs = session.orgs ?? [];

  if (orgs.length < 2) return null;

  return (
    <details className="group relative hidden shrink-0 md:block">
      <summary
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[0.78rem] text-fg transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-label={`Organization: ${session.orgId}. Switch organization`}
      >
        <Building2 size={13} aria-hidden="true" className="text-fg-muted" />
        <span className="max-w-[9rem] truncate font-medium">{session.orgId}</span>
        <ChevronDown
          size={13}
          aria-hidden="true"
          className="text-fg-muted transition-transform group-open:rotate-180"
        />
      </summary>

      <div className="absolute right-0 z-30 mt-1.5 w-64 overflow-hidden rounded-md border border-line bg-surface-1 shadow-lg">
        <p className="border-b border-line px-3 py-2 text-[0.68rem] uppercase tracking-wide text-fg-muted">
          Your organizations
        </p>
        <ul>
          {orgs.map((org) => {
            const current = org.id === session.orgId;
            return (
              <li key={org.id}>
                <form method="POST" action="/api/auth/switch-org">
                  <input type="hidden" name="orgId" value={org.id} />
                  {/* Land back on the page you were on, not on a fixed destination — the
                      equivalent page in the other org is almost always what you wanted. */}
                  <input type="hidden" name="next" value={pathname} />
                  <button
                    type="submit"
                    disabled={current}
                    className={cx(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[0.8rem] transition-colors",
                      current ? "cursor-default bg-surface-2 text-fg" : "cursor-pointer text-fg hover:bg-surface-2",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{org.id}</span>
                      <span className="mt-0.5 block text-[0.68rem] text-fg-muted">
                        {org.role}
                        {/*
                         * The repository count is the honest summary of what this org means for
                         * *you*: an outside collaborator on two repositories of a fifty-repo org
                         * should see "2 repositories", because two is what they get.
                         */}
                        {typeof org.repoCount === "number" &&
                          ` · ${org.repoCount} ${org.repoCount === 1 ? "repository" : "repositories"}`}
                        {org.member === false && " · outside collaborator"}
                      </span>
                    </span>
                    {current && <Check size={14} aria-hidden="true" className="shrink-0 text-verified" />}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
