"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ScanLine, LogOut, TerminalSquare } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { ScanRepoDialog } from "./ScanRepoDialog";
import { OrgSwitcher } from "./OrgSwitcher";
import { Button } from "./ui/Button";
import { api } from "@/lib/api-client";
import { useSession } from "@/providers/SessionProvider";
import { cx } from "@/lib/utils";

/** Polls the API's liveness probe. The free-tier API sleeps after 15 minutes
 *  idle, so "is it awake" is real, actionable state — not decoration. */
function ApiStatus() {
  const [up, setUp] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const ping = () => void api.health(controller.signal).then(setUp);
    ping();
    const timer = setInterval(ping, 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  const label = up === null ? "Checking API" : up ? "API online" : "API unreachable";

  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[0.7rem] text-fg-muted lg:inline-flex"
      title={label}
    >
      <span
        className={cx(
          "h-1.5 w-1.5 rounded-full",
          up === null ? "animate-gp-pulse bg-fg-muted" : up ? "bg-verified" : "bg-critical",
        )}
        aria-hidden="true"
      />
      <span aria-live="polite">{label}</span>
    </span>
  );
}

/**
 * Who you are signed in as, and the way out.
 *
 * The role is shown, not just the name: what this dashboard will let you do depends on it
 * (`packages/shared/src/roles.ts`), and a viewer discovering that only when a button 403s has
 * been told the wrong thing by the interface.
 *
 * Sign-out is a real `POST` form rather than a link. A GET sign-out can be fired by any image
 * tag on any page, which makes logging someone out something a third party can do to them.
 */
function SessionChip() {
  const session = useSession();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <OrgSwitcher />

      {session.development && (
        <span
          className="hidden items-center gap-1.5 rounded-full border border-medium-line bg-medium-soft px-2.5 py-1 text-[0.7rem] font-medium text-medium sm:inline-flex"
          title="Signed in through the local development sign-in — no GitHub identity was verified. Disabled when NODE_ENV=production."
        >
          <TerminalSquare size={11} aria-hidden="true" />
          Dev session
        </span>
      )}

      <span className="hidden min-w-0 flex-col items-end leading-none lg:flex">
        <span className="max-w-[10rem] truncate text-[0.78rem] font-medium text-fg">{session.login}</span>
        <span className="mt-1 text-[0.68rem] text-fg-muted">
          {session.orgId} · {session.role}
        </span>
      </span>

      <form method="POST" action="/api/auth/signout">
        <button
          type="submit"
          aria-label={`Sign out ${session.login}`}
          title="Sign out"
          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-fg-muted transition-colors duration-150 hover:bg-raised hover:text-fg"
        >
          <LogOut size={16} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

export function TopNavBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [scanOpen, setScanOpen] = useState(false);

  /* Stable identity: ScanRepoDialog's focus effect depends on this, and an
     inline arrow would re-run it on every keystroke in the search box —
     yanking focus back to the dialog's first field mid-typing. */
  const closeScan = useCallback(() => setScanOpen(false), []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/findings?q=${encodeURIComponent(q)}` : "/findings");
  }

  return (
    <>
      <header className="gp-chrome sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line px-5 sm:px-7 lg:px-9">
        <form onSubmit={submit} role="search" className="relative min-w-0 flex-1 sm:max-w-md">
          <label htmlFor="global-search" className="sr-only">
            Search findings
          </label>
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-muted"
            aria-hidden="true"
          />
          <input
            id="global-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search findings by class, path, severity…"
            className="h-10 w-full rounded-full border border-line bg-sunken pr-3.5 pl-9.5 text-[0.82rem] text-fg transition-colors placeholder:text-fg-muted hover:border-line-strong"
          />
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ApiStatus />
          <ThemeToggle />
          <Button variant="primary" size="sm" onClick={() => setScanOpen(true)}>
            <ScanLine size={14} aria-hidden="true" />
            <span className="hidden sm:inline">Scan a repo</span>
            <span className="sm:hidden">Scan</span>
          </Button>
          <span className="h-6 w-px bg-line" aria-hidden="true" />
          <SessionChip />
        </div>
      </header>

      <ScanRepoDialog open={scanOpen} onClose={closeScan} />
    </>
  );
}
