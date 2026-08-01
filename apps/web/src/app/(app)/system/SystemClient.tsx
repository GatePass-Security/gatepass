"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, KeyRound, Radio, ServerCog } from "lucide-react";
import { api } from "@/lib/api-client";
import { API_PROXY_BASE } from "@/lib/constants";
import { useOrgId } from "@/providers/SessionProvider";
import type { ApiStatus } from "@/lib/types";
import { Badge, Button, Card, CardTitle, PageHeader, Stat } from "@/components/ui";
import { cx } from "@/lib/utils";

/**
 * The API surface itself.
 *
 * Every other page drives a capability. This one covers the routes a person
 * cannot click: the GitHub webhook receiver, the self-hosted runner upload, and
 * benchmark publishing. All three are machine-to-machine and carry credentials
 * a browser must never hold, so the honest thing to show is whether the
 * deployment has them configured — not a button that pretends to invoke them.
 *
 * The credential checks work because both write routes fail closed with
 * *distinguishable* messages: an unconfigured deployment says so, a configured
 * one rejects the missing token. An unauthenticated probe is rejected before
 * anything is written, which is precisely the property being demonstrated.
 */
type Configured = "unknown" | "yes" | "no" | "unreachable";

interface Probe {
  oauth: Configured;
  runner: Configured;
  benchmarkPublish: Configured;
}

const TONE: Record<Configured, { tone: "verified" | "medium" | "critical" | "neutral"; label: string }> = {
  yes: { tone: "verified", label: "Configured" },
  no: { tone: "medium", label: "Not configured" },
  unreachable: { tone: "critical", label: "Unreachable" },
  unknown: { tone: "neutral", label: "Not checked" },
};

/** Routes grouped by who calls them, which is what decides where they can live. */
const ROUTES = [
  {
    group: "Driven from this dashboard",
    note: "Each of these has a page. Nothing below is reachable by curl but not by a person.",
    items: [
      { method: "GET", path: "/v1/orgs/:org", where: "Header and Settings" },
      { method: "PATCH", path: "/v1/orgs/:org/settings", where: "Settings" },
      { method: "GET", path: "/v1/orgs/:org/repos", where: "Repositories" },
      { method: "POST", path: "/v1/orgs/:org/scans", where: "Run a scan → Path on host" },
      { method: "POST", path: "/v1/orgs/:org/scan-remote", where: "Run a scan → GitHub repo" },
      { method: "GET", path: "/v1/orgs/:org/scans", where: "Scans" },
      { method: "GET", path: "/v1/orgs/:org/findings", where: "Overview, Findings" },
      { method: "GET", path: "/v1/scans/:id/findings", where: "Scan detail" },
      { method: "GET", path: "/v1/scans/:id/findings.sarif", where: "Scan detail → SARIF" },
      { method: "POST", path: "/v1/scans/:id/gate", where: "Scan detail → Merge gate" },
      { method: "POST", path: "/v1/findings/:fingerprint/dispute", where: "Findings → Dispute" },
      { method: "GET", path: "/v1/orgs/:org/scans/:id/agent-guidance", where: "Guidance" },
      { method: "GET", path: "/v1/orgs/:org/fleet", where: "Fleet" },
      { method: "POST", path: "/v1/orgs/:org/fleet/servers", where: "Fleet → Register" },
      { method: "POST", path: "/v1/fleet/servers/:id/rescan", where: "Fleet → Rescan" },
      { method: "GET", path: "/v1/orgs/:org/evidence", where: "Evidence" },
      { method: "POST", path: "/v1/orgs/:org/evidence/export", where: "Evidence → Send to platform" },
      { method: "POST", path: "/v1/orgs/:org/questionnaires", where: "Evidence → Draft answers" },
      { method: "POST", path: "/v1/orgs/:org/compliance/scan", where: "Compliance" },
      { method: "GET", path: "/v1/orgs/:org/compliance/results/:scanId", where: "Compliance" },
      { method: "GET", path: "/v1/public/benchmark", where: "Benchmark" },
      { method: "GET", path: "/healthz", where: "This page, header status" },
    ],
  },
  {
    group: "Machine-to-machine",
    note: "Called by GitHub, a self-hosted runner, or an operator's release job — never by a browser. Their state is checked above.",
    items: [
      { method: "POST", path: "/v1/webhooks/github", where: "GitHub App webhook, HMAC-verified" },
      { method: "POST", path: "/v1/runner/results", where: "Self-hosted runner, org-scoped bearer token" },
      { method: "POST", path: "/v1/benchmark/publish", where: "Operator token — publishes precision figures" },
      { method: "GET", path: "/v1/auth/github/login", where: "OAuth redirect" },
      { method: "POST", path: "/v1/auth/github/callback", where: "OAuth callback" },
      { method: "GET", path: "/v1/auth/me", where: "Session resolution" },
    ],
  },
];

/**
 * `apiBase` arrives as a prop rather than being imported.
 *
 * It is resolved from the server's environment, which this component cannot read — and should
 * not: publishing the API's origin into the client bundle is what made it a build-time constant
 * in the first place. The server page reads it once and hands it down for display.
 */
export interface SystemClientProps {
  apiBase: string;
  apiBaseConfigured: boolean;
}

export default function SystemClient({ apiBase, apiBaseConfigured }: SystemClientProps) {
  const orgId = useOrgId();
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [probe, setProbe] = useState<Probe>({ oauth: "unknown", runner: "unknown", benchmarkPublish: "unknown" });
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    const s = await api.status();
    setStatus(s);
    setReachable(s !== null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Ask each credential-gated route whether it is enabled. Every request here is
   * deliberately unauthenticated: the routes reject it before touching the store,
   * and the rejection message is what carries the answer.
   */
  async function checkCredentials() {
    setChecking(true);
    try {
      const [oauth, runner, bench] = await Promise.all([
        api
          .githubLoginUrl("probe")
          .then((r) => (r.url ? ("yes" as const) : ("no" as const)))
          .catch(() => "no" as const),
        probeWrite("/v1/runner/results"),
        probeWrite("/v1/benchmark/publish"),
      ]);
      setProbe({ oauth, runner, benchmarkPublish: bench });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="System"
        description="What this deployment is wired to, and every route the API answers. The endpoints a person cannot click are listed here with their configuration state."
        actions={
          <Button variant="secondary" size="md" isLoading={checking} onClick={() => void checkCredentials()}>
            <KeyRound size={15} aria-hidden="true" />
            Check credentials
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="API"
          value={reachable === null ? "…" : reachable ? "Online" : "Unreachable"}
          tone={reachable ? "verified" : reachable === false ? "critical" : "neutral"}
          icon={<Activity size={16} aria-hidden="true" />}
          caption={status?.version ? `v${status.version}` : undefined}
        />
        <Stat label="Organization" value={orgId} tone="neutral" caption="From your signed-in session" />
        <Stat
          label="OAuth"
          value={TONE[probe.oauth].label}
          tone={probe.oauth === "unknown" ? "neutral" : TONE[probe.oauth].tone}
          icon={<KeyRound size={16} aria-hidden="true" />}
        />
        <Stat
          label="Runner uploads"
          value={TONE[probe.runner].label}
          tone={probe.runner === "unknown" ? "neutral" : TONE[probe.runner].tone}
          icon={<Radio size={16} aria-hidden="true" />}
        />
      </div>

      <Card header={<CardTitle icon={<ServerCog size={15} aria-hidden="true" />}>Deployment</CardTitle>}>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <Row label="API base">
            <span className="font-mono text-[0.78rem] break-all">{apiBase}</span>
            {!apiBaseConfigured && (
              <p className="mt-1 text-[0.72rem] leading-relaxed text-critical">
                Defaulted — no GATEPASS_API_URL is set, so this dashboard is calling its own loopback.
              </p>
            )}
          </Row>
          <Row label="Service">{status?.service ?? "—"}</Row>
          <Row label="Dashboard URL known to the API">
            {status?.webAppUrl ? (
              <span className="font-mono text-[0.78rem] break-all">{status.webAppUrl}</span>
            ) : (
              <span className="text-fg-muted">Not set — GATEPASS_WEB_URL is unconfigured</span>
            )}
          </Row>
          <Row label="Benchmark publishing">
            <Badge
              tone={probe.benchmarkPublish === "unknown" ? "neutral" : TONE[probe.benchmarkPublish].tone}
              dot={probe.benchmarkPublish !== "unknown"}
            >
              {TONE[probe.benchmarkPublish].label}
            </Badge>
          </Row>
        </dl>
        {probe.oauth === "unknown" && (
          <p className="mt-4 text-[0.75rem] leading-relaxed text-fg-muted">
            Credential state is checked on request, not on load — the probes are unauthenticated calls the routes reject
            before writing anything, and each one costs a request against the org&rsquo;s rate limit.
          </p>
        )}
      </Card>

      {ROUTES.map((group) => (
        <Card
          key={group.group}
          padding={false}
          header={<CardTitle>{group.group}</CardTitle>}
          footer={<p className="text-[0.72rem] leading-relaxed text-fg-muted">{group.note}</p>}
        >
          <ul className="divide-y divide-line">
            {group.items.map((r) => (
              <li key={`${r.method} ${r.path}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5">
                <span
                  className={cx(
                    "shrink-0 font-mono text-[0.68rem] font-medium tracking-wide",
                    r.method === "GET" ? "text-fg-muted" : "text-accent",
                  )}
                >
                  {r.method}
                </span>
                <code className="min-w-0 font-mono text-[0.78rem] text-fg">{r.path}</code>
                <span className="ml-auto text-[0.75rem] text-fg-muted">{r.where}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.72rem] font-medium tracking-[0.05em] text-fg-muted uppercase">{label}</dt>
      <dd className="mt-1 text-[0.855rem] text-fg">{children}</dd>
    </div>
  );
}

/**
 * POST with no credential and read the refusal.
 *
 * Both guarded routes answer 401 either way, but the body distinguishes "no
 * token configured on this deployment" from "your token was missing or wrong" —
 * so a 401 that does *not* mention configuration means the credential is set and
 * the route is live.
 */
async function probeWrite(path: string): Promise<Configured> {
  try {
    /*
     * Through the same-origin proxy, not straight at the API. A direct call from the browser is
     * cross-origin the moment the API lives on another host — so it needed the API's address in
     * the client bundle and a CORS allowance to match, and in a deployment with neither it
     * simply dialled localhost. The proxy attaches this session's bearer, which changes nothing
     * here: these routes authenticate against their own runner/admin tokens, so a session token
     * is still not one, and the 401 body still carries the answer.
     */
    const res = await fetch(`${API_PROXY_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    // The proxy's own answer when it cannot reach upstream. Reading it as "got past the guard"
    // would report an unreachable API as a configured credential.
    if (res.status === 502) return "unreachable";
    if (res.status === 401) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return /not enabled on this deployment/i.test(body?.error ?? "") ? "no" : "yes";
    }
    // Any other status means the request got past the credential guard.
    return "yes";
  } catch {
    return "unreachable";
  }
}
