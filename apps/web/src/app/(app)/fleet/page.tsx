"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Plus,
  RefreshCw,
  ScanLine,
  Server,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { ORG_ID } from "@/lib/constants";
import type { FleetPosture, FleetServer, FleetView } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorPanel,
  FilterPill,
  IconButton,
  Input,
  PageHeader,
  PageSkeleton,
  Stat,
  useToast,
  type Tone,
} from "@/components/ui";
import { POSTURE_LABEL, POSTURE_TOKEN, cx, pluralize, sharePercent } from "@/lib/utils";
import { errorToast } from "@/lib/errors";

type PostureFilter = FleetPosture | "all";

const EMPTY_FORM = { name: "", endpointOrRepo: "", configHash: "" };

/** Filter order is worst-first, matching how the severity ramp reads everywhere else. */
const FILTERS: readonly FleetPosture[] = ["critical", "findings_open", "passing", "unscanned"];

/**
 * Share of the registered fleet. `sharePercent` never rounds a partial count up
 * to 100% (or a non-zero one down to 0%) — a posture tile claiming the whole
 * fleet passes when one server does not is the exact class of unearned number
 * this product exists to eliminate.
 */
function shareOfFleet(count: number, total: number): string | undefined {
  const pct = sharePercent(count, total);
  return pct && `${pct} of fleet`;
}

export default function FleetPage() {
  const [data, setData] = useState<FleetView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<unknown>(null);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [rescanningId, setRescanningId] = useState<string | null>(null);
  const [filter, setFilter] = useState<PostureFilter>("all");
  const { toast } = useToast();
  const formId = useId();

  const loadFleet = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getFleet(ORG_ID));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFleet();
  }, [loadFleet]);

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRegistering(true);
    setRegisterError(null);
    try {
      const created = await api.registerFleetServer(ORG_ID, form);
      toast(`Registered ${created.name}`, "success");
      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadFleet();
    } catch (err) {
      // Surfaced inline rather than only logged — a failed registration used to
      // look identical to a successful one.
      setRegisterError(err);
    } finally {
      setRegistering(false);
    }
  }

  async function handleRescan(server: FleetServer) {
    setRescanningId(server.id);
    try {
      const updated = await api.rescanFleetServer(server.id, server.endpointOrRepo);
      toast(
        `${updated.name} — ${POSTURE_LABEL[updated.posture]}`,
        updated.posture === "critical" ? "error" : "success",
      );
      await loadFleet();
    } catch (err) {
      toast(errorToast(err, { action: `rescan ${server.name}` }), "error");
    } finally {
      setRescanningId(null);
    }
  }

  const servers = data?.servers ?? [];
  const visible = filter === "all" ? servers : servers.filter((s) => s.posture === filter);

  // Counted off the same array the cards render from, so a pill's count can
  // never disagree with the number of cards below it.
  const postureCounts = servers.reduce<Record<FleetPosture, number>>(
    (acc, s) => {
      acc[s.posture] += 1;
      return acc;
    },
    { critical: 0, findings_open: 0, passing: 0, unscanned: 0 },
  );

  const header = (
    <PageHeader
      title="Fleet"
      description="MCP servers registered to this org, their last recorded posture, and the scan behind it."
      actions={
        <>
          <IconButton label="Refresh fleet" onClick={() => void loadFleet()} disabled={loading}>
            <RefreshCw size={16} className={cx(loading && "animate-spin")} aria-hidden="true" />
          </IconButton>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowForm((open) => !open)}
            aria-expanded={showForm}
            aria-controls={formId}
          >
            <Plus size={15} aria-hidden="true" />
            Add server
          </Button>
        </>
      }
    />
  );

  if (loading && !data) {
    return <PageSkeleton stats={5} rows={3} />;
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorPanel error={error} context={{ action: "load the fleet" }} onRetry={() => void loadFleet()} />
      </div>
    );
  }

  const rollup = data?.rollup;

  return (
    <div className="space-y-6">
      {header}

      <span aria-live="polite" className="sr-only">
        {loading ? "Refreshing fleet" : `${servers.length} ${pluralize(servers.length, "server")} loaded`}
      </span>

      {/* A refresh that fails while stale data is still on screen must say so. */}
      {error != null && (
        <ErrorPanel error={error} context={{ action: "refresh the fleet" }} onRetry={() => void loadFleet()} />
      )}

      {rollup && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Registered"
            value={rollup.total}
            icon={<Server size={16} aria-hidden="true" />}
            caption={rollup.total > 0 ? `${rollup.total - rollup.unscanned} of ${rollup.total} scanned` : undefined}
          />
          <Stat
            label="Passing"
            value={rollup.passing}
            tone="verified"
            icon={<ShieldCheck size={16} aria-hidden="true" />}
            caption={shareOfFleet(rollup.passing, rollup.total)}
          />
          <Stat
            label="Findings open"
            value={rollup.findings_open}
            tone="medium"
            icon={<AlertTriangle size={16} aria-hidden="true" />}
            caption={shareOfFleet(rollup.findings_open, rollup.total)}
          />
          <Stat
            label="Critical"
            value={rollup.critical}
            tone="critical"
            icon={<ShieldAlert size={16} aria-hidden="true" />}
            caption={shareOfFleet(rollup.critical, rollup.total)}
          />
          <Stat
            label="Unscanned"
            value={rollup.unscanned}
            tone="low"
            icon={<Clock size={16} aria-hidden="true" />}
            caption={shareOfFleet(rollup.unscanned, rollup.total)}
          />
        </div>
      )}

      {/* Hidden rather than unmounted: `aria-controls` on the trigger stays valid
          and a half-typed registration survives an accidental collapse. */}
      <Card
        hidden={!showForm}
        id={formId}
        header={<CardTitle icon={<Server size={15} />}>Register MCP server</CardTitle>}
      >
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="payments-mcp"
              autoComplete="off"
            />
            <Input
              label="Endpoint or repo path"
              required
              value={form.endpointOrRepo}
              onChange={(e) => setForm({ ...form, endpointOrRepo: e.target.value })}
              placeholder="/srv/repos/payments-mcp"
              hint="Rescan reads this path directly on the API host."
              autoComplete="off"
            />
          </div>
          <Input
            label="Config hash"
            value={form.configHash}
            onChange={(e) => setForm({ ...form, configHash: e.target.value })}
            placeholder="sha256 prefix"
            hint="Optional — stored so a later change to the config can be detected."
            autoComplete="off"
          />
          {registerError != null && <ErrorPanel error={registerError} context={{ action: "register that server" }} />}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" size="sm" isLoading={registering}>
              Register server
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setRegisterError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>

      {servers.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterPill active={filter === "all"} onClick={() => setFilter("all")} count={servers.length}>
              All
            </FilterPill>
            {FILTERS.map((posture) => (
              <FilterPill
                key={posture}
                active={filter === posture}
                onClick={() => setFilter(posture)}
                tone={POSTURE_TOKEN[posture] as Tone}
                count={postureCounts[posture]}
              >
                {POSTURE_LABEL[posture]}
              </FilterPill>
            ))}
          </div>
          <p className="text-[0.78rem] text-fg-muted">
            Showing {visible.length} of {servers.length} {pluralize(servers.length, "server")}
          </p>
        </div>
      )}

      {servers.length === 0 ? (
        <EmptyState
          icon={<Server size={20} />}
          title="No servers registered"
          description="Register an MCP server to record its config and track the posture of its last scan."
          action={{ label: "Add server", onClick: () => setShowForm(true) }}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Server size={20} />}
          title={`No ${POSTURE_LABEL[filter as FleetPosture].toLowerCase()} servers`}
          description="No registered server currently has this posture."
          action={{ label: "Show all servers", onClick: () => setFilter("all") }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              expanded={expandedServer === server.id}
              onToggle={() => setExpandedServer(expandedServer === server.id ? null : server.id)}
              rescanning={rescanningId === server.id}
              onRescan={handleRescan}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ServerCard({
  server,
  expanded,
  onToggle,
  rescanning,
  onRescan,
}: {
  server: FleetServer;
  expanded: boolean;
  onToggle: () => void;
  rescanning: boolean;
  onRescan: (server: FleetServer) => void;
}) {
  const panelId = useId();
  const tone = POSTURE_TOKEN[server.posture] as Tone;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 truncate text-[0.9rem] font-medium text-fg" title={server.name}>
          {server.name}
        </h3>
        <Badge tone={tone} dot>
          {POSTURE_LABEL[server.posture]}
        </Badge>
      </div>

      <p className="mt-1.5 truncate font-mono text-[0.72rem] text-fg-muted" title={server.endpointOrRepo}>
        {server.endpointOrRepo}
      </p>

      <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-[0.72rem]">
        <div className="flex items-center justify-between gap-3">
          <dt className="shrink-0 text-fg-muted">Config hash</dt>
          <dd className="truncate font-mono text-fg-secondary">
            {server.configHash ? server.configHash.slice(0, 12) : "Not set"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="shrink-0 text-fg-muted">Last scan</dt>
          <dd className="truncate font-mono text-fg-secondary">
            {server.lastScanId ? server.lastScanId.slice(0, 12) : "Never scanned"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          isLoading={rescanning}
          onClick={() => onRescan(server)}
          aria-label={`Rescan ${server.name}`}
        >
          {!rescanning && <ScanLine size={14} aria-hidden="true" />}
          {rescanning ? "Rescanning" : "Rescan"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={expanded} aria-controls={panelId}>
          Details
          <ChevronDown
            size={14}
            className={cx("transition-transform duration-150", expanded && "rotate-180")}
            aria-hidden="true"
          />
        </Button>
      </div>

      {/* Rendered but hidden rather than unmounted, so `aria-controls` always
          resolves to a real element. */}
      <div hidden={!expanded} id={panelId} className="mt-3 rounded-[0.75rem] border border-line bg-sunken p-3">
        <dl className="space-y-2.5">
          <DetailRow label="Server ID" value={server.id} mono />
          <DetailRow label="Endpoint or repo" value={server.endpointOrRepo} mono />
          <DetailRow label="Config hash" value={server.configHash || "Not set"} mono={Boolean(server.configHash)} />
          <DetailRow
            label="Last scan ID"
            value={server.lastScanId ?? "Never scanned"}
            mono={Boolean(server.lastScanId)}
          />
          <DetailRow label="Organisation" value={server.orgId} />
        </dl>
      </div>
    </Card>
  );
}

/** Stacked label/value — long ids and paths wrap instead of forcing the card wide. */
function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[0.7rem] text-fg-muted">{label}</dt>
      <dd className={cx("mt-0.5 text-[0.72rem] break-all text-fg-secondary", mono && "font-mono")}>{value}</dd>
    </div>
  );
}
