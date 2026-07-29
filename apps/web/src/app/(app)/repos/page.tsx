"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FolderGit2, Globe, HardDrive, Link2, Lock, ScanLine, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { useOrgId, useHasRole } from "@/providers/SessionProvider";
import type { GateFailureMode, GateMode, RepoRecord } from "@/lib/types";
import { repoLabel } from "@/lib/utils";
import { errorToast } from "@/lib/errors";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorPanel,
  PageHeader,
  PageSkeleton,
  Select,
  Toggle,
  useToast,
} from "@/components/ui";
import { ScanRepoDialog } from "@/components/ScanRepoDialog";
import { ConnectRepoDialog } from "@/components/ConnectRepoDialog";

/**
 * Connected repositories.
 *
 * This page used to carry a footnote apologising for three of its own columns, because the
 * route behind it returned placeholders rather than facts. All three are now real, and the
 * reasoning that produced that footnote is what shapes the table now:
 *
 *   - **`visibility`** was the literal `"private"` for every repository, never read from
 *     GitHub. It is now read from GitHub when a GitHub App is configured and **omitted
 *     entirely otherwise** — so this table shows a visibility only when one is known, and
 *     shows nothing when it is not. A security dashboard printing "Private" beside a public
 *     repository has told the operator something false about their exposure, and that is the
 *     one mistake this product cannot make. Absent is honest; a default is not.
 *   - **`frameworks`** was always `[]`. It is now written by the scan that detected them, so
 *     the column is empty exactly when nothing has scanned the repo yet.
 *   - **The gate** was the deployment default on every row because per-repo settings were not
 *     stored. `PATCH /orgs/:org/repos/:repo` is implemented now, the settings persist, and
 *     the column is editable in place by an admin.
 */

type Status = "loading" | "ready" | "unreachable";

const SCAN_STATUS_LABEL: Record<RepoRecord["scanStatus"], string> = {
  never_scanned: "Never scanned",
  scanning: "Scanning",
  complete: "Scanned",
  failed: "Failed",
};

const SCAN_STATUS_TONE = {
  never_scanned: "neutral",
  scanning: "medium",
  complete: "verified",
  failed: "critical",
} as const;

const GATE_MODE_OPTIONS: Array<{ value: GateMode; label: string }> = [
  { value: "off", label: "Off — annotate only" },
  { value: "block_verified", label: "Block on verified findings" },
  { value: "block_threshold", label: "Block on severity threshold" },
];

export default function ReposPage() {
  const orgId = useOrgId();
  const isAdmin = useHasRole("admin");
  const { toast } = useToast();
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [failure, setFailure] = useState<unknown>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setRepos(await api.getRepos(orgId));
      setStatus("ready");
    } catch (err) {
      setFailure(err);
      setStatus("unreachable");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upsert = useCallback((repo: RepoRecord) => {
    setRepos((prev) => {
      const i = prev.findIndex((r) => r.name === repo.name);
      if (i === -1) return [...prev, repo];
      const next = [...prev];
      next[i] = repo;
      return next;
    });
  }, []);

  const disconnect = useCallback(
    async (repo: RepoRecord) => {
      const previous = repos;
      setRepos((prev) => prev.filter((r) => r.name !== repo.name));
      try {
        await api.disconnectRepo(orgId, repo.name);
        toast(`Disconnected ${repoLabel(repo.name) ?? repo.name}. Its scans and findings are kept.`, "success");
      } catch (err) {
        // Put the row back. An optimistic removal that silently stuck would tell the operator
        // a repository is no longer watched when it still is.
        setRepos(previous);
        toast(errorToast(err, { action: `disconnect ${repoLabel(repo.name) ?? repo.name}` }), "error");
      }
    },
    [orgId, repos, toast],
  );

  if (status === "loading") return <PageSkeleton rows={6} />;

  /*
   * This used to end "Gatepass never writes to your code or CI", which stopped being true
   * when suggested-fix pull requests landed. The claim that still holds is the narrow one, so
   * that is what it says now: CI is never touched, and code is only ever written on a new
   * branch that somebody explicitly asked for. Overstating it here would be the same mistake
   * as an unmeasured precision claim — a promise on our own dashboard that does not survive
   * being checked.
   */
  const description =
    "Repositories Gatepass watches for this organization. Scanning is read-only. Gatepass never modifies your CI " +
    "configuration, and only ever writes code to a new branch in a pull request you ask for.";

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="md" onClick={() => setScanOpen(true)}>
        <ScanLine size={15} aria-hidden="true" />
        Scan a repo
      </Button>
      {isAdmin && (
        <Button variant="primary" size="md" onClick={() => setConnectOpen(true)}>
          <Link2 size={15} aria-hidden="true" />
          Connect repository
        </Button>
      )}
    </div>
  );

  if (status === "unreachable") {
    return (
      <div className="space-y-6">
        <PageHeader title="Repositories" description={description} />
        <ErrorPanel error={failure} context={{ action: "load repositories" }} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Repositories" description={description} actions={actions} />

      {repos.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 className="h-5 w-5" aria-hidden="true" />}
          title="No repositories connected"
          description={
            isAdmin
              ? "Connect a repository the Gatepass App can read, or scan a directory on the API host — that connects it too."
              : "Nothing is connected yet. Connecting a repository needs an admin; you can still scan a directory on the API host."
          }
          action={actions}
        />
      ) : (
        <Card
          padding={false}
          header={
            <CardTitle icon={<FolderGit2 size={15} aria-hidden="true" />}>
              {repos.length} connected {repos.length === 1 ? "repository" : "repositories"}
            </CardTitle>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-[0.855rem]">
              <caption className="sr-only">Connected repositories, their scan state, and their gate settings</caption>
              <thead>
                <tr className="border-b border-line bg-sunken">
                  {["Repository", "Scan state", "Frameworks", "Merge gate", "Latest scan", ""].map((h, i) => (
                    <th
                      key={h || `actions-${i}`}
                      scope="col"
                      className="px-4 py-2.5 text-left text-[0.68rem] font-medium tracking-[0.06em] text-fg-muted uppercase"
                    >
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {repos.map((repo) => (
                  <RepoRow
                    key={repo.name}
                    repo={repo}
                    orgId={orgId}
                    canEdit={isAdmin}
                    onUpdated={upsert}
                    onDisconnect={disconnect}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ScanRepoDialog open={scanOpen} onClose={() => setScanOpen(false)} />
      <ConnectRepoDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={upsert}
        connected={repos.map((r) => r.name)}
      />
    </div>
  );
}

function RepoRow({
  repo,
  orgId,
  canEdit,
  onUpdated,
  onDisconnect,
}: {
  repo: RepoRecord;
  orgId: string;
  canEdit: boolean;
  onUpdated: (repo: RepoRecord) => void;
  onDisconnect: (repo: RepoRecord) => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (patch: { gate_mode?: GateMode; gate_failure_mode?: GateFailureMode }) => {
      setSaving(true);
      try {
        onUpdated(await api.patchRepo(orgId, repo.name, patch));
      } catch (err) {
        toast(errorToast(err, { action: `save settings for ${repoLabel(repo.name) ?? repo.name}` }), "error");
      } finally {
        setSaving(false);
      }
    },
    [orgId, repo.name, onUpdated, toast],
  );

  return (
    <tr className="border-b border-line align-top transition-colors last:border-b-0 hover:bg-raised/60">
      <td className="px-4 py-3">
        {/* The name is often an absolute path on the API host. Lead with the leaf so the column
            stays scannable, keep the full value underneath so it is still identifiable. */}
        <span className="block font-medium text-fg">{repoLabel(repo.name) ?? repo.name}</span>
        <span className="mt-0.5 block max-w-[24rem] truncate font-mono text-[0.7rem] text-fg-muted" title={repo.name}>
          {repo.name}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.7rem] text-fg-muted">
          {repo.source === "local_path" ? (
            <span className="inline-flex items-center gap-1">
              <HardDrive size={10} aria-hidden="true" />
              Path on API host
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <FolderGit2 size={10} aria-hidden="true" />
              GitHub
            </span>
          )}
          {/*
           * Visibility renders only when GitHub actually told us. There is deliberately no
           * "unknown" chip either — a row that simply omits it says the same thing without
           * adding noise to every row on a deployment with no GitHub App.
           */}
          {repo.visibility && (
            <span className="inline-flex items-center gap-1">
              ·
              {repo.visibility === "public" ? (
                <Globe size={10} aria-hidden="true" />
              ) : (
                <Lock size={10} aria-hidden="true" />
              )}
              {repo.visibility}
            </span>
          )}
        </span>
      </td>

      <td className="px-4 py-3">
        <Badge tone={SCAN_STATUS_TONE[repo.scanStatus]} dot>
          {SCAN_STATUS_LABEL[repo.scanStatus]}
        </Badge>
      </td>

      <td className="px-4 py-3">
        {repo.frameworks.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {repo.frameworks.map((f) => (
              <Badge key={f} tone="neutral">
                {f}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-[0.78rem] text-fg-muted">—</span>
        )}
      </td>

      <td className="px-4 py-3">
        {canEdit ? (
          <div className="min-w-[15rem] space-y-2">
            <Select
              label="Gate mode"
              aria-label={`Merge gate mode for ${repo.name}`}
              value={repo.gateMode}
              disabled={saving}
              options={GATE_MODE_OPTIONS}
              onChange={(e) => void save({ gate_mode: e.target.value as GateMode })}
            />
            {/*
             * fail-closed is a per-repository opt-in, never a default (CLAUDE.md rule 4): a
             * gate that blocks merges when Gatepass itself is unavailable is a decision a
             * team makes, not one a deployment makes for them.
             */}
            <Toggle
              label="Block when Gatepass can't complete"
              checked={repo.gateFailureMode === "fail_closed"}
              disabled={saving}
              onChange={(next) => void save({ gate_failure_mode: next ? "fail_closed" : "fail_open" })}
            />
          </div>
        ) : (
          <span className="font-mono text-[0.74rem] text-fg-muted">
            {repo.gateMode} · {repo.gateFailureMode}
          </span>
        )}
      </td>

      <td className="px-4 py-3">
        {repo.lastScanId ? (
          <Link
            href={`/scans/${repo.lastScanId}`}
            className="cursor-pointer font-mono text-[0.74rem] text-accent hover:underline"
          >
            {repo.lastScanId.slice(0, 8)}
          </Link>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>

      <td className="px-4 py-3 text-right">
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDisconnect(repo)}
            aria-label={`Disconnect ${repo.name}`}
            title="Disconnect. Scans and findings already recorded are kept."
          >
            <Trash2 size={14} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Disconnect</span>
          </Button>
        )}
      </td>
    </tr>
  );
}
