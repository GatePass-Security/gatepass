"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ScanLine } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { ScanRepoDialog } from "./ScanRepoDialog";
import { Button } from "./ui/Button";
import { api } from "@/lib/api-client";
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
        </div>
      </header>

      <ScanRepoDialog open={scanOpen} onClose={closeScan} />
    </>
  );
}
