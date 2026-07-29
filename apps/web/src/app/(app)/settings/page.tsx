"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, FolderGit2, Info } from "lucide-react";

import { api } from "@/lib/api-client";
import { errorToast } from "@/lib/errors";
import { useOrgId, useHasRole } from "@/providers/SessionProvider";
import type { OrgRecord, RepoRecord } from "@/lib/types";
import { pluralize } from "@/lib/utils";
import { useOrg } from "@/providers/OrgProvider";
import { ConnectGitHubCard } from "@/components/ConnectGitHubCard";
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  ErrorPanel,
  PageHeader,
  PageSkeleton,
  Skeleton,
  Toggle,
  useToast,
  type Tone,
} from "@/components/ui";

const DESCRIPTION =
  "Organization analysis toggles, plus the repository configuration the API reports. Toggles apply immediately.";

interface OrgSettings {
  llmEnabled: boolean;
  agentLoopEnabled: boolean;
  fixPrEnabled: boolean;
}

type SettingKey = "llm_analysis_enabled" | "agent_loop_enabled" | "fix_pr_enabled";

/*
 * The only three fields `PATCH /v1/orgs/:org/settings` accepts (handlers.ts
 * `updateOrgSettings`). Plan tier is set by billing and the org id is its
 * identity, so neither is editable here — and there is deliberately no
 * per-repo entry, because no route backs one.
 */
const TOGGLES = [
  {
    key: "llm_analysis_enabled",
    field: "llmEnabled",
    label: "LLM analysis",
    description: "Research-tier semantic analysis during scans for this organization.",
  },
  {
    key: "agent_loop_enabled",
    field: "agentLoopEnabled",
    label: "Agent loop",
    description: "Required before the Guidance page can return remediation steps.",
  },
  {
    key: "fix_pr_enabled",
    field: "fixPrEnabled",
    label: "Fix pull requests",
    // The only setting here that permits a write to a customer repository, so it
    // states the limits of that write rather than just naming the feature.
    description:
      "Lets someone open a pull request from a scan's applicable fixes. Gatepass commits to a new branch only " +
      "when a person asks, never modifies CI configuration, and never merges.",
  },
] as const satisfies ReadonlyArray<{
  key: SettingKey;
  field: keyof OrgSettings;
  label: string;
  description: string;
}>;

/*
 * `setFlag` used to branch on "is this the LLM one?" to build both the optimistic
 * object and the PATCH body, which only worked while there were exactly two
 * toggles. The key→field mapping already exists in TOGGLES, so it is read from
 * there: adding a fourth toggle needs no change below this line.
 */
const FIELD_OF = Object.fromEntries(TOGGLES.map((t) => [t.key, t.field])) as Record<SettingKey, keyof OrgSettings>;

/** `fixPrEnabled` is optional on the wire; absent means off. */
function readSettings(org: OrgRecord): OrgSettings {
  return {
    llmEnabled: org.llmEnabled,
    agentLoopEnabled: org.agentLoopEnabled,
    fixPrEnabled: org.fixPrEnabled ?? false,
  };
}

const SCAN_STATUS: Record<RepoRecord["scanStatus"], { label: string; tone: Tone }> = {
  never_scanned: { label: "Never scanned", tone: "low" },
  scanning: { label: "Scanning", tone: "research" },
  complete: { label: "Scanned", tone: "verified" },
  failed: { label: "Scan failed", tone: "critical" },
};

const GATE_MODE: Record<RepoRecord["gateMode"], string> = {
  off: "Gate off",
  block_verified: "Blocks on verified",
  block_threshold: "Blocks on threshold",
};

const GATE_FAILURE: Record<RepoRecord["gateFailureMode"], string> = {
  fail_open: "Fails open",
  fail_closed: "Fails closed",
};

export default function SettingsPage() {
  const orgId = useOrgId();
  const isAdmin = useHasRole("admin");
  const { org, loading: orgLoading, error: orgError, refetch } = useOrg();
  const { toast } = useToast();

  /*
   * Local state holds only what this page has written since mount; before the
   * first successful PATCH the org record from the provider is the truth. That
   * ordering is what lets `refetch()` below run without ever clobbering a
   * newer optimistic value.
   */
  const [written, setWritten] = useState<OrgSettings | null>(null);
  const [pending, setPending] = useState<SettingKey | null>(null);

  const [repos, setRepos] = useState<RepoRecord[] | null>(null);
  const [reposError, setReposError] = useState<unknown>(null);

  const loadRepos = useCallback(async () => {
    setReposError(null);
    setRepos(null);
    try {
      setRepos(await api.getRepos(orgId));
    } catch (err) {
      setReposError(err);
    }
  }, [orgId]);

  useEffect(() => {
    void loadRepos();
  }, [loadRepos]);

  const settings: OrgSettings | null = written ?? (org ? readSettings(org) : null);

  async function setFlag(key: SettingKey, label: string, next: boolean) {
    if (!settings) return;
    const previous = settings;

    setWritten({ ...settings, [FIELD_OF[key]]: next });
    setPending(key);
    try {
      const patch: Partial<Record<SettingKey, boolean>> = { [key]: next };
      const updated = await api.patchOrgSettings(orgId, patch);
      // Reconcile from the returned record, not from the optimistic guess — the
      // route ignores unknown keys, so the response is the only proof of what
      // was actually persisted.
      setWritten(readSettings(updated));
      refetch();
      toast(`${label} ${next ? "enabled" : "disabled"}`, "success");
    } catch (err) {
      setWritten(previous);
      toast(errorToast(err, { action: `update ${label.toLowerCase()}` }), "error");
    } finally {
      setPending(null);
    }
  }

  if (orgLoading && !org) return <PageSkeleton stats={0} rows={4} />;

  if (!org || !settings) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" description={DESCRIPTION} />
        <ErrorPanel
          error={orgError ?? new Error("The organization record is unavailable.")}
          context={{ subject: "organization", action: "load settings" }}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description={DESCRIPTION} />

      <ConnectGitHubCard />

      <Card header={<CardTitle icon={<Building2 size={15} />}>Organization</CardTitle>}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-[0.72rem] font-medium tracking-[0.05em] text-fg-muted uppercase">Organization ID</dt>
            <dd className="mt-1.5 truncate font-mono text-[0.82rem] text-fg">{org.id}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.72rem] font-medium tracking-[0.05em] text-fg-muted uppercase">Plan tier</dt>
            <dd className="mt-1.5">
              <Badge tone="accent" className="capitalize">
                {org.planTier}
              </Badge>
            </dd>
          </div>
        </dl>

        <div className="mt-5 space-y-4 border-t border-line pt-5">
          {TOGGLES.map((toggle) => (
            <Toggle
              key={toggle.key}
              label={toggle.label}
              description={toggle.description}
              checked={settings[toggle.field]}
              /*
               * Locked during a write so two PATCHes cannot interleave and reconcile out of
               * order — and locked outright for anyone below admin.
               *
               * The second is presentation, not protection: `PATCH /v1/orgs/:org/settings`
               * requires admin at the API (`requiredRole` in apps/api/src/auth.ts, pinned by
               * apps/api/test/server-side-authz.test.ts), so a non-admin who flips this in the
               * DOM gets a 403 either way. What it buys is honesty — a switch that moves and
               * then silently fails has told the user something untrue about what they may do.
               * The role itself is not the browser's to decide: it arrives from the verified
               * `/v1/auth/me`, which now reports GitHub's current answer rather than whatever
               * the session token was issued with.
               */
              disabled={pending !== null || !isAdmin}
              onChange={(next) => void setFlag(toggle.key, toggle.label, next)}
            />
          ))}
          <p role="status" aria-live="polite" className="h-4 text-[0.72rem] text-fg-muted">
            {pending ? "Saving…" : ""}
          </p>
        </div>
      </Card>

      {reposError ? (
        <ErrorPanel error={reposError} context={{ action: "load repositories" }} onRetry={() => void loadRepos()} />
      ) : repos === null ? (
        <Card header={<CardTitle icon={<FolderGit2 size={15} />}>Repositories</CardTitle>}>
          <div className="space-y-2" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading repositories</span>
            <Skeleton variant="row" />
            <Skeleton variant="row" />
            <Skeleton variant="row" />
          </div>
        </Card>
      ) : repos.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 className="h-5 w-5" />}
          title="No repositories"
          description="The API has not reported any repositories for this organization."
        />
      ) : (
        <Card
          header={
            <CardTitle
              icon={<FolderGit2 size={15} />}
              action={
                <span data-numeric className="shrink-0 text-[0.72rem] text-fg-muted">
                  {repos.length} {pluralize(repos.length, "repository", "repositories")}
                </span>
              }
            >
              Repositories
            </CardTitle>
          }
        >
          <p className="flex items-start gap-2 rounded-[0.6rem] border border-line bg-sunken px-3 py-2.5 text-[0.78rem] leading-relaxed text-fg-muted">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Scan status and gate configuration are reported by the API. They cannot be changed from the dashboard.
            </span>
          </p>

          <ul className="mt-4 space-y-2.5">
            {repos.map((repo) => {
              const status = SCAN_STATUS[repo.scanStatus];
              return (
                <li key={repo.name} className="rounded-[0.75rem] border border-line bg-raised px-3.5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <span className="min-w-0 flex-1 truncate text-[0.855rem] font-medium text-fg">{repo.name}</span>
                    <Badge size="sm" tone={status.tone} dot>
                      {status.label}
                    </Badge>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <Badge size="sm">{GATE_MODE[repo.gateMode]}</Badge>
                    <Badge size="sm">{GATE_FAILURE[repo.gateFailureMode]}</Badge>
                  </div>

                  {repo.frameworks.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[0.72rem] font-medium tracking-[0.05em] text-fg-muted uppercase">
                        Detected frameworks
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {repo.frameworks.map((framework) => (
                          <Badge key={framework} size="sm">
                            {framework}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {repo.lastScanId && (
                    <p className="mt-3 text-[0.72rem] text-fg-muted">
                      Last scan <span className="font-mono break-all text-fg-secondary">{repo.lastScanId}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
