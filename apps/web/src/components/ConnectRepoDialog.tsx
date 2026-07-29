"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FolderGit2, Globe, Link2, Lock, Search, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { useOrgId } from "@/providers/SessionProvider";
import type { AvailableRepos, RepoRecord } from "@/lib/types";
import { explainError, type FriendlyError } from "@/lib/errors";
import { Button, Input, ErrorState, SegmentedControl, Skeleton } from "./ui";

/**
 * Connect a repository.
 *
 * Before this existed a repository appeared in the inventory only as a side effect of
 * something scanning it — there was no way to say "watch this" and no way to stop.
 *
 * Two doors, because deployments differ:
 *
 *   - **From the installation.** Lists what the Gatepass App can already read
 *     (`GET /v1/orgs/:org/repos/available`, which is `GET /installation/repositories`
 *     underneath). Available only where a GitHub App is configured, which most deployments
 *     have not done.
 *   - **By name.** `owner/name`, typed. Works with no GitHub App at all; the record is then
 *     created without a visibility, and the repos table shows nothing in that column rather
 *     than guessing.
 *
 * Connecting is a read plus a row. Nothing here writes to a repository, and the API has no
 * code path from this route that could (CLAUDE.md rule 2).
 */

type Mode = "installation" | "name";

export function ConnectRepoDialog({
  open,
  onClose,
  onConnected,
  connected,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the new record so the caller can update its list without a refetch. */
  onConnected: (repo: RepoRecord) => void;
  /** Names already connected, so the installation list can mark them rather than offer them. */
  connected: readonly string[];
}) {
  const orgId = useOrgId();
  const [mode, setMode] = useState<Mode>("installation");
  const [available, setAvailable] = useState<AvailableRepos | null>(null);
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    api
      .getAvailableRepos(orgId)
      .then((res) => {
        if (cancelled) return;
        setAvailable(res);
        // Nothing to pick from ⇒ open on the door that works, rather than on an empty list.
        if (!res.configured) setMode("name");
      })
      .catch(() => {
        if (!cancelled) {
          setAvailable({ configured: false, repos: [] });
          setMode("name");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, orgId]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Keep Tab inside the dialog — a modal that leaks focus to the page behind it is not
      // actually modal for keyboard users.
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [open, onClose]);

  const connect = useCallback(
    async (repo: string) => {
      setBusy(repo);
      setError(null);
      try {
        const record = await api.connectRepo(orgId, repo);
        onConnected(record);
        setAvailable((prev) => (prev ? { ...prev, repos: prev.repos.filter((r) => r.name !== repo) } : prev));
        setName("");
      } catch (err) {
        setError(explainError(err, { action: `connect ${repo}` }));
      } finally {
        setBusy(null);
      }
    },
    [orgId, onConnected],
  );

  if (!open) return null;

  const connectedSet = new Set(connected);
  const query = filter.trim().toLowerCase();
  const matches = (available?.repos ?? []).filter((r) => !query || r.name.toLowerCase().includes(query));
  const typed = name.trim();
  const typedIsValid = /^[\w.-]+\/[\w.-]+$/.test(typed);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 pt-[10vh]">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-dialog-title"
        className="animate-gp-rise gp-card relative w-full max-w-lg border-line-strong"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id="connect-dialog-title" className="text-[1rem] font-medium tracking-[-0.02em] text-fg">
              Connect a repository
            </h2>
            <p className="mt-1 text-[0.78rem] text-fg-muted">
              {/* Not "never writes to your code" any more — suggested-fix pull requests do,
                  on request. The unconditional half of the promise is CI, so that is the half
                  stated unconditionally. */}
              Gatepass reads the repository to scan it. It never modifies your CI configuration, and writes code only in
              a pull request you ask for.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mt-1 -mr-1 cursor-pointer rounded-full p-2 text-fg-muted transition-colors hover:bg-raised hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {available === null ? (
            <div className="space-y-2" aria-busy="true">
              <span className="sr-only">Loading repositories</span>
              <Skeleton variant="bare" className="h-9 w-full rounded-full" />
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} variant="bare" className="h-14 w-full rounded-[0.6rem]" />
              ))}
            </div>
          ) : (
            <>
              {available.configured && (
                <SegmentedControl<Mode>
                  label="How to connect"
                  value={mode}
                  onChange={(next) => {
                    setMode(next);
                    setError(null);
                  }}
                  options={[
                    { value: "installation", label: "From GitHub App" },
                    { value: "name", label: "By name" },
                  ]}
                />
              )}

              {mode === "installation" && available.configured ? (
                <InstallationPicker
                  repos={matches}
                  connectedSet={connectedSet}
                  filter={filter}
                  onFilter={setFilter}
                  busy={busy}
                  onConnect={connect}
                  filterRef={firstFieldRef}
                  total={available.repos.length}
                />
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (typedIsValid) void connect(typed);
                  }}
                  className="space-y-4"
                >
                  <Input
                    ref={available.configured ? undefined : firstFieldRef}
                    label="Repository"
                    placeholder="owner/name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    hint={
                      available.configured
                        ? "Use this for a repository the Gatepass App can reach but that is not in the list above."
                        : "This deployment has no GitHub App, so Gatepass cannot read the repository's visibility and the table will leave that column blank rather than guess."
                    }
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="ghost" size="md" onClick={onClose}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="md"
                      isLoading={busy === typed}
                      disabled={!typedIsValid}
                    >
                      {busy !== typed && <Link2 size={15} aria-hidden="true" />}
                      Connect
                    </Button>
                  </div>
                </form>
              )}

              {error && <ErrorState error={error} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The installation list.
 *
 * `visibility` is shown here and only here in the connect flow, because this list came from
 * GitHub. A repository connected by name on a deployment with no App has no visibility at all,
 * and the table renders nothing for it.
 *
 * Even here it is rendered conditionally rather than assumed. This list is the likeliest place
 * to have one, not a guarantee of one: an installation payload that omitted both `private` and
 * `visibility` reaches us with the key absent, and the icon must not fall through to a Lock —
 * a padlock beside a public repository is the false-exposure claim this product cannot make,
 * and it is no less false for appearing in a dialog than in the table.
 */
function InstallationPicker({
  repos,
  connectedSet,
  filter,
  onFilter,
  busy,
  onConnect,
  filterRef,
  total,
}: {
  repos: AvailableRepos["repos"];
  connectedSet: Set<string>;
  filter: string;
  onFilter: (v: string) => void;
  busy: string | null;
  onConnect: (repo: string) => void;
  filterRef: React.RefObject<HTMLInputElement | null>;
  total: number;
}) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <label htmlFor="connect-filter" className="sr-only">
          Filter repositories
        </label>
        <Search
          size={14}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-muted"
          aria-hidden="true"
        />
        <input
          id="connect-filter"
          ref={filterRef}
          type="search"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder="Filter by name…"
          className="h-9 w-full rounded-full border border-line bg-sunken pr-3 pl-9 text-[0.82rem] text-fg transition-colors placeholder:text-fg-muted hover:border-line-strong"
        />
      </div>

      {total === 0 ? (
        <p className="rounded-[0.6rem] border border-line bg-sunken px-4 py-6 text-center text-[0.8rem] leading-relaxed text-fg-muted">
          The Gatepass App installation can read no repositories that are not already connected. Grant it access to more
          on GitHub, or connect one by name.
        </p>
      ) : repos.length === 0 ? (
        <p className="rounded-[0.6rem] border border-line bg-sunken px-4 py-6 text-center text-[0.8rem] text-fg-muted">
          No repository matches “{filter}”.
        </p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {repos.map((repo) => {
            const already = connectedSet.has(repo.name);
            return (
              <li key={repo.githubRepoId}>
                <div className="flex items-center gap-3 rounded-[0.6rem] border border-line px-3 py-2.5">
                  <FolderGit2 size={15} className="shrink-0 text-fg-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.82rem] font-medium text-fg">{repo.name}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[0.7rem] text-fg-muted">
                      {repo.visibility && (
                        <>
                          {repo.visibility === "public" ? (
                            <Globe size={10} aria-hidden="true" />
                          ) : (
                            <Lock size={10} aria-hidden="true" />
                          )}
                          {repo.visibility}
                        </>
                      )}
                      {repo.defaultBranch && (
                        <span className="font-mono">
                          {repo.visibility ? " · " : ""}
                          {repo.defaultBranch}
                        </span>
                      )}
                    </span>
                  </span>
                  {already ? (
                    <span className="flex shrink-0 items-center gap-1 text-[0.72rem] text-verified">
                      <Check size={12} aria-hidden="true" />
                      Connected
                    </span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      isLoading={busy === repo.name}
                      disabled={busy !== null}
                      onClick={() => onConnect(repo.name)}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
