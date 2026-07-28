"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FolderGit2, ScanLine } from "lucide-react";
import { api } from "@/lib/api-client";
import { ORG_ID } from "@/lib/constants";
import type { RepoRecord } from "@/lib/types";
import { repoLabel } from "@/lib/utils";
import { Badge, Button, Card, CardTitle, EmptyState, ErrorPanel, PageHeader, PageSkeleton } from "@/components/ui";
import { ScanRepoDialog } from "@/components/ScanRepoDialog";

/**
 * Connected repositories.
 *
 * `GET /v1/orgs/:org/repos` had a client method and no page, so the only view of
 * which repos Gatepass can see was a network tab.
 *
 * Three of the fields this route returns are placeholders rather than facts, and
 * the table is shaped around that (`apps/api/src/handlers.ts`, `listRepos`):
 *
 *   - `visibility` is the literal `"private"` for every repo. It is not read
 *     from GitHub, so it is not rendered — a dashboard that prints "Private"
 *     beside a public repo has told the operator something false about their
 *     exposure, which is the one mistake a security tool cannot make.
 *   - `frameworks` is always `[]` here, so the column could only ever be a row
 *     of dashes.
 *   - `gateMode`/`gateFailureMode` are the deployment defaults, not per-repo
 *     settings — `PATCH /orgs/:org/repos/:repo` is unimplemented — so the column
 *     says "default" and the footnote says why.
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

export default function ReposPage() {
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [failure, setFailure] = useState<unknown>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setRepos(await api.getRepos(ORG_ID));
      setStatus("ready");
    } catch (err) {
      setFailure(err);
      setStatus("unreachable");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") return <PageSkeleton rows={6} />;

  const description =
    "Repositories the Gatepass GitHub App can read. Access is contents:read — Gatepass never writes to your code or CI.";

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
      <PageHeader
        title="Repositories"
        description={description}
        actions={
          <Button variant="primary" size="md" onClick={() => setScanOpen(true)}>
            <ScanLine size={15} aria-hidden="true" />
            Scan a repo
          </Button>
        }
      />

      {repos.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 className="h-5 w-5" aria-hidden="true" />}
          title="No repositories connected"
          description="Install the Gatepass GitHub App on an organization, or scan a repository directly to get started."
          action={
            <Button variant="primary" size="md" onClick={() => setScanOpen(true)}>
              <ScanLine size={15} aria-hidden="true" />
              Scan a repo
            </Button>
          }
        />
      ) : (
        <Card
          padding={false}
          header={
            <CardTitle icon={<FolderGit2 size={15} aria-hidden="true" />}>
              {repos.length} connected {repos.length === 1 ? "repository" : "repositories"}
            </CardTitle>
          }
          footer={
            <p className="text-[0.72rem] leading-relaxed text-fg-muted">
              The gate column is this deployment&rsquo;s default, not a per-repository setting — those are not stored
              yet, so the value is identical on every row. Repository visibility is not shown because this route does
              not read it from GitHub.
            </p>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-[0.855rem]">
              <caption className="sr-only">Connected repositories and their scan state</caption>
              <thead>
                <tr className="border-b border-line bg-sunken">
                  {["Repository", "Scan state", "Gate (default)", "Latest scan"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-2.5 text-left text-[0.68rem] font-medium tracking-[0.06em] text-fg-muted uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {repos.map((repo) => (
                  <tr
                    key={repo.name}
                    className="border-b border-line transition-colors last:border-b-0 hover:bg-raised/60"
                  >
                    <td className="px-4 py-3">
                      {/* The name is often an absolute path on the API host. Lead with
                          the leaf so the column stays scannable, keep the full value
                          underneath so it is still identifiable. */}
                      <span className="block font-medium text-fg">{repoLabel(repo.name) ?? repo.name}</span>
                      <span
                        className="mt-0.5 block max-w-[30rem] truncate font-mono text-[0.7rem] text-fg-muted"
                        title={repo.name}
                      >
                        {repo.name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={SCAN_STATUS_TONE[repo.scanStatus]} dot>
                        {SCAN_STATUS_LABEL[repo.scanStatus]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-[0.74rem] text-fg-muted">
                      {repo.gateMode} · {repo.gateFailureMode}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ScanRepoDialog open={scanOpen} onClose={() => setScanOpen(false)} />
    </div>
  );
}
